import { assetCachePolicy } from './assetCachePolicy';

test('only content-hashed JavaScript and CSS have long-lived immutable caching', () => {
  expect(assetCachePolicy('/assets/App-7ojvup-z.js')).toBe('public, max-age=31536000, immutable');
  expect(assetCachePolicy('/assets/index-CJmGoI8v.css?version=test')).toBe('public, max-age=31536000, immutable');
  expect(assetCachePolicy('/assets/main.js')).toBe('no-cache');
  expect(assetCachePolicy('/assets/live-gps.json')).toBe('no-store');
  expect(assetCachePolicy('/assets/../index-12345678.js')).toBe('no-cache');
});

test('HTML and SPA routes revalidate instead of serving an old deployment', () => {
  expect(assetCachePolicy('/')).toBe('no-cache');
  expect(assetCachePolicy('/index.html')).toBe('no-cache');
  expect(assetCachePolicy('/live-map?bus=test')).toBe('no-cache');
  expect(assetCachePolicy('/records')).toBe('no-cache');
});

test('GPS, health, auth, Supabase paths and JSON are never cached by this policy', () => {
  for (const path of ['/api/gps/update', '/api/health', '/auth/v1/token', '/rest/v1/buses', '/realtime/v1/websocket', '/storage/v1/test', '/functions/v1/test', '/latest_gps.json']) {
    expect(assetCachePolicy(path)).toBe('no-store');
  }
});

test('public branding images have a bounded cache rather than an immutable lifetime', () => {
  expect(assetCachePolicy('/centrabus-login-logo.png')).toBe('public, max-age=3600, must-revalidate');
  expect(assetCachePolicy('/centrabus-locked-logo.png')).toBe('public, max-age=3600, must-revalidate');
  expect(assetCachePolicy('/unrelated-private-image.png')).toBe('no-cache');
});
