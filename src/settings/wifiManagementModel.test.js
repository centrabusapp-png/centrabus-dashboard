import { pendingWifiService, pendingWifiState, publicWifiState, validateWifiPlan, wifiStatusPresentation } from './wifiManagementModel';

const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;
const plan = { deviceId: 'GPS-001', ssid: 'Bus depot', security: 'wpa2-personal', priority: 50 };

test.each(['Depot\'s & "Bus" <A>', '  exact spaces  ', 'バス停', 'x'.repeat(32)])('validates literal special SSID safely: %s', (ssid) => {
  expect(validateWifiPlan({ ...plan, ssid })).toBe('');
  expect(publicWifiState({ deviceId: 'GPS-001', integration: 'ready', profiles: [{ ...plan, ssid }] }, 'GPS-001').profiles[0].ssid).toBe(ssid);
});

test.each(['', 'x'.repeat(33), '界'.repeat(11), 'line\nname', '\0name'])('rejects invalid SSID without echoing content: %s', (ssid) => {
  expect(validateWifiPlan({ ...plan, ssid })).toBe('SSID must contain 1–32 UTF-8 bytes without control characters.');
});

test.each([-1, 101, 2.5, NaN, '50'])('rejects invalid priority %s', (priority) => {
  expect(validateWifiPlan({ ...plan, priority })).toContain('whole number');
});

test('unsupported device/security fails closed', () => {
  expect(validateWifiPlan({ ...plan, deviceId: 'GPS-003' })).toContain('supported GPS device');
  expect(validateWifiPlan({ ...plan, security: 'open' })).toContain('WPA2');
});

test.each(['', 'valid test password', 'a'.repeat(64)])('validates optional draft password or WPA2 PSK without returning it', (password) => {
  expect(validateWifiPlan({ ...plan, password })).toBe('');
});

test.each(['short', 'a'.repeat(65), 'line\npassword', 'non-ascii-秘密'])('rejects unsupported password without echoing it', (password) => {
  const error = validateWifiPlan({ ...plan, password });
  expect(error).toContain('printable ASCII');
  expect(error).not.toContain(password);
});

test('WPA3 does not accept the WPA2 raw 64-hex key contract', () => {
  expect(validateWifiPlan({ ...plan, security: 'wpa3-personal', password: 'a'.repeat(64) })).toContain('printable ASCII');
});

test('default pending service has no network/storage side effects or fake connected state', async () => {
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('network forbidden'); });
  const write = jest.spyOn(Storage.prototype, 'setItem');
  expect(await pendingWifiService.getState('GPS-001')).toEqual(pendingWifiState('GPS-001'));
  expect(wifiStatusPresentation(pendingWifiState('GPS-001'))).toMatchObject({ management: 'Integration pending', wifi: 'Unknown', internet: 'Unknown' });
  expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  fetch.mockRestore(); write.mockRestore();
});

test('public projection strips passwords, tokens and arbitrary nested data', () => {
  const projected = publicWifiState({ deviceId: 'GPS-001', integration: 'ready', password: 'test-secret-only', token: 'test-token-only',
    profiles: [{ ...plan, password: 'test-secret-only', psk: 'test-secret-only' }] }, 'GPS-001');
  expect(JSON.stringify(projected)).not.toMatch(/test-secret-only|test-token-only|password|psk|token/);
  expect(projected.profiles).toEqual([{ ssid: plan.ssid, priority: 50, security: plan.security }]);
});

test('wrong-device report is rejected and pending cannot claim configuration success', () => {
  expect(() => publicWifiState({ deviceId: 'GPS-002' }, 'GPS-001')).toThrow('wrong-device');
  expect(publicWifiState({ deviceId: 'GPS-001', integration: 'pending', configuration: 'applied', profiles: [] }, 'GPS-001')).toMatchObject({ configuration: 'unknown', profiles: null });
});

test('online Wi-Fi is not conflated with internet availability', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  const state = { ...plan, integration: 'ready', reportedAt: new Date(now).toISOString(), wifiConnected: true, internetReachable: false };
  expect(wifiStatusPresentation(state, now)).toMatchObject({ management: 'Reporting', wifi: 'Connected', internet: 'Not reachable' });
  expect(wifiStatusPresentation(state, now + 90_001)).toMatchObject({ management: 'Offline · last report expired', wifi: 'Unknown', internet: 'Unknown' });
});

test.each([null, 'bad-date', '2026-10-12T10:00:00', '2026-10-12T11:00:00Z'])('missing/malformed/future report never claims online: %s', (reportedAt) => {
  expect(wifiStatusPresentation({ integration: 'ready', reportedAt, wifiConnected: true }, Date.parse('2026-10-12T10:00:00Z')).wifi).toBe('Unknown');
});
