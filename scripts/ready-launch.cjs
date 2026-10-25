'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { collect, profile, validateReleaseFiles, writeJson } = require('./release-files.cjs');
async function main() {
  const root = path.resolve(__dirname, '..'), p = profile(root);
  if (Number(process.versions.node.split('.')[0]) !== p.nodeMajor) throw Error('Use Node 22.x for launch validation.');
  const errors = validateReleaseFiles(root);
  if (errors.length) throw Error(errors.join('\n'));
  const before = collect(root);
  let envDirectory = root;
  try {
    const saved = execFileSync('git', ['-C', root, 'config', '--local', '--get', 'centrabus.sourceRoot'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (saved) envDirectory = fs.realpathSync(saved);
  } catch { /* The active frontend is intentionally not a Git repository. */ }
  const { loadEnv } = await import('vite');
  const loaded = loadEnv('production', envDirectory, 'VITE_');
  const publicEnv = { VITE_BACKEND_URL: p.backendOrigin, VITE_SUPABASE_URL: p.supabaseOrigin,
    VITE_SUPABASE_PUBLISHABLE_KEY: loaded.VITE_SUPABASE_PUBLISHABLE_KEY, ...p.defaultFlags };
  if (loaded.VITE_SUPABASE_URL && new URL(loaded.VITE_SUPABASE_URL).origin !== p.supabaseOrigin) throw Error('Frontend Supabase project differs from launch profile; review project selection.');
  for (const key of Object.keys(loaded)) if (/^VITE_.*(?:SECRET|PASSWORD|PRIVATE|SERVICE.?ROLE|ACCESS.?TOKEN|REFRESH.?TOKEN|DEVICE.?KEY)/i.test(key)) throw Error('Remove private credential names from frontend configuration; values withheld.');
  if (loaded.VITE_TOMTOM_API_KEY) publicEnv.VITE_TOMTOM_API_KEY = loaded.VITE_TOMTOM_API_KEY;
  const configErrors = require('./check-deployment-config.cjs').validateDeploymentConfig(publicEnv);
  if (configErrors.length) throw Error(configErrors.join('\n'));
  const env = Object.fromEntries(['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter(key => process.env[key] != null).map(key => [key, process.env[key]]));
  Object.assign(env, publicEnv, { NODE_ENV: 'production' });
  const outputDir = path.join(root, '.launch-check');
  fs.mkdirSync(outputDir, { recursive: true });
  const tests = fs.readdirSync(path.join(root, 'scripts')).filter(name => name.endsWith('.test.cjs')).map(name => 'scripts/' + name);
  const checks = [
    ['deployment-tests', ['--test', ...tests]],
    ['production-build', ['node_modules/vite/bin/vite.js', 'build']],
  ];
  for (const [name, args] of checks) {
    console.log('DASHBOARD_CHECK=' + name + '; credentials are not printed');
    const run = spawnSync(process.execPath, args, { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 6_000_000 });
    fs.writeFileSync(path.join(outputDir, name + '.log'), (run.stdout || '') + (run.stderr || ''));
    if (run.status !== 0) throw Error(name + ' failed; review .launch-check/' + name + '.log');
  }
  if (collect(root).digest !== before.digest) throw Error('Code changed during validation; rerun against the completed edit.');
  writeJson(path.join(outputDir, 'receipt.json'), { schema: 'centrabus-dashboard-launch-v1', at: new Date().toISOString(),
    digest: before.digest, files: before.files.length, buildPassed: true, deploymentTestsPassed: true,
    privateConfigPrinted: false, pushed: false, deployed: false });
  console.log('DASHBOARD_LAUNCH_CHECK=PASS; latest source verified; no commit, push, deployment or device operation');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
