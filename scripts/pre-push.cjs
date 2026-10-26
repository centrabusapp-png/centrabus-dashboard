'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertReceipt, collect, inspectPublic } = require('./release-files.cjs');
function main() {
  const root = path.resolve(__dirname, '..');
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['status', '--porcelain'])) throw Error('Working tree is not committed; prepare, review and commit the latest dashboard first.');
  const current = assertReceipt(root);
  const head = git(['rev-parse', 'HEAD']);
  const refs = fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
  if (refs.some(line => line.split(' ')[1] !== head)) throw Error('Only the validated current HEAD can pass this launch check.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'deployment/source-manifest.json')));
  if (manifest.digest !== current.digest || JSON.stringify(manifest.files) !== JSON.stringify(current.files)) throw Error('Prepared publication manifest differs from current source.');
  let source;
  try { source = git(['config', '--local', '--get', 'centrabus.sourceRoot']); } catch { /* Standalone clone. */ }
  if (source && collect(source).digest !== current.digest) throw Error('Newer edits exist in the active dashboard; prepare those edits before pushing.');
  const allowed = new Set([...current.files.map(row => row.path), 'deployment/source-manifest.json']);
  for (const name of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (!allowed.has(name) && !/^[A-Z0-9_-]+\.md$/.test(name)) throw Error('Unreviewed publication path outside the current source manifest: ' + name);
    inspectPublic(name, fs.readFileSync(path.join(root, name)));
  }
  console.log('DASHBOARD_PRE_PUSH=PASS; committed, tested, current frontend; no private/runtime files');
}
if (require.main === module) { try { main(); } catch (error) { console.error('DASHBOARD_PRE_PUSH=STOP; ' + error.message); process.exitCode = 1; } }
