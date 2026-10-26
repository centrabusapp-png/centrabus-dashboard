const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { collect, writeJson } = require('./release-files.cjs');
function fixture(work) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'centrabus-push-test-'));
  const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => { git(['add', '.']); git(['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=LaunchFixture', '-c', 'user.email=launch-fixture@example.test', 'commit', '-qm', 'synthetic local fixture']); };
  try {
    fs.mkdirSync(path.join(repo, 'scripts')); fs.mkdirSync(path.join(repo, 'src'));
    for (const name of ['pre-push.cjs', 'release-files.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(repo, 'scripts', name));
    fs.writeFileSync(path.join(repo, '.gitignore'), '.launch-check/\n');
    fs.writeFileSync(path.join(repo, 'src/page.js'), 'export default "original";');
    git(['init', '-q']);
    const snapshot = collect(repo);
    writeJson(path.join(repo, 'deployment/source-manifest.json'), snapshot);
    writeJson(path.join(repo, '.launch-check/receipt.json'), { digest: snapshot.digest, buildPassed: true, deploymentTestsPassed: true });
    commit();
    const run = () => spawnSync(process.execPath, ['scripts/pre-push.cjs'], { cwd: repo, encoding: 'utf8', windowsHide: true,
      input: 'refs/heads/main ' + git(['rev-parse', 'HEAD']) + ' refs/heads/main ' + '0'.repeat(40) + '\n' });
    work({ base, repo, git, commit, run, snapshot });
  } finally {
    if (path.dirname(fs.realpathSync(base)) !== fs.realpathSync(os.tmpdir())) throw Error('Unexpected fixture cleanup target');
    fs.rmSync(base, { recursive: true });
  }
}
test('pre-push accepts a clean validated commit but rejects newer uncommitted dashboard work', () => fixture(({ repo, run }) => {
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(repo, 'src/page.js'), 'export default "unfinished";');
  const stopped = run(); assert.notEqual(stopped.status, 0); assert.match(stopped.stderr, /not committed/);
}));
test('a new clean commit without a matching production receipt cannot be pushed', () => fixture(({ repo, commit, run }) => {
  fs.writeFileSync(path.join(repo, 'src/page.js'), 'export default "new commit";'); commit();
  const stopped = run(); assert.notEqual(stopped.status, 0); assert.match(stopped.stderr, /Source changed/);
}));
test('a clean old publication cannot push when the canonical source has newer edits', () => fixture(({ base, repo, git, run, snapshot }) => {
  const active = path.join(base, 'active');
  for (const file of snapshot.files) {
    const target = path.join(active, file.path); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, file.path), target);
  }
  git(['config', '--local', 'centrabus.sourceRoot', active]);
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(active, 'src/page.js'), 'export default "latest active edit";');
  const stopped = run(); assert.notEqual(stopped.status, 0); assert.match(stopped.stderr, /Newer edits exist/);
}));
