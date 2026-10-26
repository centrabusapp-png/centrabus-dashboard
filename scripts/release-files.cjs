'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha = data => createHash('sha256').update(data).digest('hex');
const TOP = ['package.json', 'package-lock.json', 'index.html', 'vite.config.mjs', 'vercel.json',
  'postcss.config.cjs', 'tailwind.config.cjs', 'cameraFrameProxy.mjs', 'cameraFrameProxy.test.mjs',
  'remoteWifiProxy.mjs', 'remoteWifiProxy.test.mjs', 'localCameraCapture.mjs', 'localCameraCapture.test.mjs',
  '.gitignore', '.vercelignore', '.env.example', 'README.md', 'BRAND_LOCK.md', 'LAUNCHING.md', 'AGENTS.md',
  'qa/wifi-management/index.html', 'qa/wifi-management/main.jsx', 'qa/wifi-management/vite.config.mjs'];
const DIRS = ['src', 'scripts', 'public', 'deployment', '.githooks', '.github'];
const excluded = name => /(?:^|\/)(?:node_modules|dist|build|coverage|captured-images|__pycache__|\.test-tmp|\.launch-check)(?:\/|$)|\.before[-_.]|(?:^|\/)App_before|\.bak$|\.backup|\.pyc$/.test(name);
function inspectPublic(name, data) {
  if (excluded(name) || /(?:^|\/)(?:backend|device|local-backups|historical|sources|PI [^/]+)(?:\/|$)/i.test(name)) throw Error('Non-frontend runtime/archive path refused: ' + name);
  if (name !== '.env.example' && /(?:^|\/)(?:\.env(?:\.|$)|[^/]*credentials[^/]*|[^/]*service-account[^/]*|camera-private\.json)|\.(?:pem|key|sqlite\d*|db)$/i.test(name)) throw Error('Private/runtime file refused: ' + name);
  if (data.length > 10 * 1024 * 1024) throw Error('Review oversized frontend file: ' + name);
  if (!/\.(?:png|jpe?g|gif|ico|woff2?|ttf|eot)$/i.test(name)) {
    const text = data.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text)) throw Error('Credential review required: ' + name);
    for (const match of text.matchAll(/\bsb_secret_[A-Za-z0-9_-]{16,}/g)) {
      if (!/^sb_secret_(?:synthetic|fixture)(?:_|$)/.test(match[0])) throw Error('Backend credential refused: ' + name);
    }
  }
}
function collect(root) {
  root = fs.realpathSync(root);
  const files = [];
  function file(name) {
    if (excluded(name) || name === 'deployment/source-manifest.json') return;
    const full = path.join(root, name), info = fs.lstatSync(full);
    if (info.isSymbolicLink() || !info.isFile()) throw Error('Source link/non-file refused: ' + name);
    const data = fs.readFileSync(full);
    inspectPublic(name, data);
    files.push({ path: name, bytes: data.length, sha256: sha(data) });
  }
  function walk(relative) {
    const info = fs.lstatSync(path.join(root, relative));
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Source directory link refused: ' + relative);
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative + '/' + entry.name;
      if (excluded(name) || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(name);
      else if (entry.isSymbolicLink()) throw Error('Source link refused: ' + name);
      else file(name);
    }
  }
  for (const name of TOP) if (fs.existsSync(path.join(root, name))) file(name);
  for (const name of DIRS) if (fs.existsSync(path.join(root, name))) walk(name);
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (files.reduce((sum, row) => sum + row.bytes, 0) > 50 * 1024 * 1024) throw Error('Frontend release exceeds source review budget');
  return { files, digest: sha(JSON.stringify(files)) };
}
function profile(root) { return JSON.parse(fs.readFileSync(path.join(root, 'deployment/launch-profile.json'))); }
function validateReleaseFiles(root, { hostedBuild = process.env.VERCEL === '1' } = {}) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    const p = profile(root), errors = [];
    if (p.version !== 1 || p.framework !== 'vite' || p.nodeMajor !== 22 || p.rootDirectory !== '.') errors.push('Unsupported launch profile.');
    for (const key of ['framework', 'installCommand', 'buildCommand', 'outputDirectory']) {
      if (config[key] !== p[key]) errors.push('Vercel/profile setting differs: ' + key);
    }
    if (pkg.engines?.node !== '22.x' || lock.packages[''].engines?.node !== '22.x') errors.push('Keep the locked Node 22.x deployment engine.');
    for (const field of ['dependencies', 'devDependencies']) {
      if (JSON.stringify(pkg[field]) !== JSON.stringify(lock.packages[''][field])) errors.push('Package/lock dependency mismatch: ' + field);
    }
    if (pkg.scripts['build:vercel'] !== 'node scripts/check-deployment-config.cjs && vite build') errors.push('The guarded Vercel build command changed.');
    if (!config.rewrites?.some(row => row.source === p.spaFallback && row.destination === '/index.html')) errors.push('Missing future-page SPA fallback.');
    if (config.rewrites?.some(row => /^https?:/.test(row.destination))) errors.push('Unexpected external rewrite; cloud camera uses the reviewed HTTPS client.');
    const rule = new RegExp('^/' + p.spaFallback.slice('/:path('.length, -1) + '$');
    for (const url of ['/live-camera', '/vehicle-condition', '/a-future-page/nested']) if (!rule.test(url)) errors.push('SPA fallback misses frontend pages.');
    for (const url of ['/api', '/api/gps/update', '/auth/callback', '/assets/test.js', '/readyz']) if (rule.test(url)) errors.push('SPA fallback must not rewrite reserved paths.');
    for (const name of ['.gitignore', '.vercelignore']) {
      const ignoreFile = path.join(root, name);
      // Vercel filters local ignore files out of the uploaded build inputs.
      // Local preparation/push still requires both exclusion files; a hosted
      // build validates them if supplied and keeps every other release check.
      if (hostedBuild && !fs.existsSync(ignoreFile)) continue;
      if (!fs.readFileSync(ignoreFile, 'utf8').includes('.env')) errors.push('Environment-file exclusion missing: ' + name);
    }
    return errors;
  } catch { return ['Release configuration is incomplete or unreadable.']; }
}
function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, filename);
}
function assertReceipt(root) {
  const current = collect(root);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(root, '.launch-check/receipt.json'))); }
  catch { throw Error('Run npm run ready:launch before preparing/pushing this source.'); }
  if (receipt.digest !== current.digest || receipt.buildPassed !== true || receipt.deploymentTestsPassed !== true) throw Error('Source changed after validation; run npm run ready:launch again.');
  return current;
}
module.exports = { collect, sha, profile, inspectPublic, validateReleaseFiles, writeJson, assertReceipt };
