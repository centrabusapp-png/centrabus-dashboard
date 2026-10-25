const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateDeploymentConfig } = require('./check-deployment-config.cjs');
const fixture = () => ({ VITE_BACKEND_URL: 'https://api.example.test', VITE_SUPABASE_URL: 'https://database.example.test',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_fixture_only', VITE_CAMERA_READINGS_ENABLED: 'false', VITE_WIFI_STATUS_ENABLED: 'false' });

test('complete public-only deployment configuration has no shape errors', () => {
  assert.deepEqual(validateDeploymentConfig(fixture()), []);
});

test('missing/insecure/path-bearing backend URL is rejected without printing its value', () => {
  for (const url of [undefined, '', 'http://localhost:5000', 'https://127.0.0.1', 'https://10.0.0.1', 'https://api.example.test/api', 'https://fixture:private-value@api.example.test']) {
    const errors = validateDeploymentConfig({ ...fixture(), VITE_BACKEND_URL: url });
    assert.ok(errors.length); assert.ok(!JSON.stringify(errors).includes('private-value'));
  }
});

test('backend secret/service role keys and private VITE names cannot be published', () => {
  const serviceRole = `fixture.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fixture`;
  for (const key of ['sb_secret_fixture_do_not_publish', serviceRole]) {
    assert.ok(validateDeploymentConfig({ ...fixture(), VITE_SUPABASE_PUBLISHABLE_KEY: key }).length);
  }
  assert.ok(validateDeploymentConfig({ ...fixture(), VITE_DEVICE_SECRET: 'synthetic-secret' }).length);
});

test('legacy anon-shaped key is accepted as public configuration, not authenticated by this check', () => {
  const key = `fixture.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.fixture`;
  assert.deepEqual(validateDeploymentConfig({ ...fixture(), VITE_SUPABASE_PUBLISHABLE_KEY: key }), []);
});

test('this release cannot turn on unverified camera or device reporting by a build flag', () => {
  for (const name of ['VITE_CAMERA_READINGS_ENABLED', 'VITE_WIFI_STATUS_ENABLED']) {
    assert.ok(validateDeploymentConfig({ ...fixture(), [name]: 'true' }).length);
  }
});

test('Vercel deployment uses active Vite output, deferred guarded build and known SPA routes', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.framework, 'vite'); assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'npm run build:vercel');
  for (const source of ['/live-map', '/alerts', '/vehicle-condition']) {
    assert.ok(config.rewrites.some((entry) => entry.source === source && entry.destination === '/index.html'));
  }
  const fallback = config.rewrites.at(-1);
  const matches = new RegExp('^/' + fallback.source.slice('/:path('.length, -1) + '$');
  assert.equal(matches.test('/api/private-data'), false);
  assert.ok(config.headers.some((entry) => entry.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-cache')));
  const immutableRules = config.headers.filter((entry) => entry.headers.some((header) => header.value.includes('immutable')));
  const matchesImmutable = (url) => immutableRules.some((entry) => new RegExp(`^${entry.source.replace(':file', '')}$`).test(url));
  assert.equal(matchesImmutable('/assets/index-CJmGoI8v.js'), true);
  assert.equal(matchesImmutable('/assets/index-CJmGoI8v.css'), true);
  assert.equal(matchesImmutable('/assets/main.js'), false);
  assert.equal(matchesImmutable('/assets/telemetry.json'), false);
  const ignore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
  for (const pattern of ['.env', '**/*.key', '**/*.sqlite*', 'backend', 'superbus']) assert.ok(ignore.includes(pattern));
});
