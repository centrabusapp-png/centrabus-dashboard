import { resolveBackendConfig } from './backendConfig';

const config = (overrides = {}) => resolveBackendConfig({ nodeEnv: 'production', backendUrl: '', legacyGpsUrl: '', wifiStatusEnabled: 'false', ...overrides });

test('production never falls back to localhost or a legacy GPS endpoint', () => {
  expect(config()).toMatchObject({ configured: false, origin: null, healthUrl: null, reason: 'missing' });
  expect(config({ legacyGpsUrl: 'http://localhost:5000/api/gps/update' }).configured).toBe(false);
});

test('a public HTTPS origin provides separate health and read-only management URLs', () => {
  expect(config({ backendUrl: 'https://api.example.test/' })).toMatchObject({
    configured: true, origin: 'https://api.example.test', healthUrl: 'https://api.example.test/health',
    wifiStatusBaseUrl: 'https://api.example.test/api/wifi-management/devices', wifiStatusEnabled: false,
  });
});

test.each(['http://api.example.test', 'https://*.vercel.app', 'https://localhost:5000', 'https://127.0.0.1', 'https://10.0.0.1',
  'https://192.168.1.5', 'https://172.16.0.1', 'https://pi.local', 'https://[::1]',
  'https://user:fixture@api.example.test', 'https://api.example.test/api', 'https://api.example.test?key=fixture',
  'https://api.example.test#fragment', '/api', 'not-a-url'])('unsafe/malformed production origin is unconfigured: %s', (backendUrl) => {
  const resolved = config({ backendUrl });
  expect(resolved.configured).toBe(false);
  expect(resolved.origin).toBeNull();
  expect(JSON.stringify(resolved)).not.toContain('fixture');
});

test('local development retains its existing localhost default and legacy option', () => {
  expect(config({ nodeEnv: 'development' }).healthUrl).toBe('http://localhost:5000/health');
  expect(config({ nodeEnv: 'test', legacyGpsUrl: 'http://127.0.0.1:5000/api/gps/update/' }).healthUrl).toBe('http://127.0.0.1:5000/health');
});

test('an explicitly invalid new value never silently falls back to another server', () => {
  expect(config({ nodeEnv: 'development', backendUrl: 'invalid', legacyGpsUrl: 'http://localhost:5000/api/gps/update' }).configured).toBe(false);
});

test.each([undefined, '', 'false', 'TRUE', '1', true])('read-only status requires the exact explicit flag: %s', (wifiStatusEnabled) => {
  expect(config({ wifiStatusEnabled }).wifiStatusEnabled).toBe(false);
});

test('remote Wi-Fi is never activated by a production build or a truthy non-string flag', () => {
  expect(config({ remoteWifiEnabled: 'true' }).remoteWifiEnabled).toBe(false);
  expect(config({ nodeEnv: 'development', remoteWifiEnabled: true }).remoteWifiEnabled).toBe(false);
  expect(config({ nodeEnv: 'development', remoteWifiEnabled: 'true' }).remoteWifiEnabled).toBe(true);
});
