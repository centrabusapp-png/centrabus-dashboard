const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collect, profile, inspectPublic, validateReleaseFiles, writeJson, assertReceipt } = require('./release-files.cjs');
const root = path.resolve(__dirname, '..');
function temporary(work) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'centrabus-launch-test-'));
  try { return work(dir); } finally {
    if (path.dirname(fs.realpathSync(dir)) !== fs.realpathSync(os.tmpdir())) throw Error('Unexpected fixture cleanup target');
    fs.rmSync(dir, { recursive: true });
  }
}
test('future nested pages refresh, while API/auth/static paths are excluded from SPA fallback', () => {
  const p = profile(root);
  const source = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'))).rewrites.at(-1).source;
  assert.equal(source, p.spaFallback);
  const matches = new RegExp('^/' + source.slice('/:path('.length, -1) + '$');
  for (const page of ['/new-page', '/new-page/edit', '/live-camera', '/vehicle-condition']) assert.equal(matches.test(page), true);
  for (const endpoint of ['/api', '/api/device', '/auth/callback', '/assets/a.js', '/health', '/readyz']) assert.equal(matches.test(endpoint), false);
});
test('a source edit after a good production receipt invalidates readiness', () => temporary(dir => {
  fs.mkdirSync(path.join(dir, 'src'));
  const file = path.join(dir, 'src/new-page.jsx'); fs.writeFileSync(file, 'export default "first";');
  writeJson(path.join(dir, '.launch-check/receipt.json'), { digest: collect(dir).digest, buildPassed: true, deploymentTestsPassed: true });
  assert.doesNotThrow(() => assertReceipt(dir));
  fs.writeFileSync(file, 'export default "newer edit";');
  assert.throws(() => assertReceipt(dir), /Source changed/);
}));
test('private/runtime files and literal credentials cannot become public source', () => {
  for (const name of ['src/.env', 'public/camera-private.json', 'public/gps.sqlite3', 'public/server.key', 'captured-images/dashboard.png', 'node_modules/large-package.js']) {
    assert.throws(() => inspectPublic(name, Buffer.from('synthetic input')));
  }
  assert.throws(() => inspectPublic('src/config.js', Buffer.from('sb_' + 'secret_' + 'A'.repeat(40))));
  assert.doesNotThrow(() => inspectPublic('scripts/example.test.cjs', Buffer.from('sb_' + 'secret_fixture_do_not_publish')));
});
test('new pages are collected and old snapshots/environments are excluded', () => temporary(dir => {
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src/new-page.jsx'), 'latest page');
  fs.writeFileSync(path.join(dir, 'src/old.js.before-snapshot'), 'old snapshot');
  fs.writeFileSync(path.join(dir, '.env'), 'DO_NOT_PUBLISH=private-fixture');
  assert.deepEqual(collect(dir).files.map(row => row.path), ['src/new-page.jsx']);
}));
test('changing Vercel output independently of the contract stops release validation', () => temporary(dir => {
  fs.mkdirSync(path.join(dir, 'deployment'));
  for (const name of ['vercel.json', 'package.json', 'package-lock.json', '.gitignore', '.vercelignore', 'deployment/launch-profile.json']) fs.copyFileSync(path.join(root, name), path.join(dir, name));
  assert.deepEqual(validateReleaseFiles(dir), []);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'vercel.json'))); config.outputDirectory = 'wrong-output';
  fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify(config));
  assert.ok(validateReleaseFiles(dir).some(error => error.includes('outputDirectory')));
}));
