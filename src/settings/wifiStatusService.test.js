import { createWifiStatusService } from './wifiStatusService';
import { pendingWifiState, wifiStatusPresentation } from './wifiManagementModel';
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const config = { configured: true, wifiStatusEnabled: true, wifiStatusBaseUrl: 'https://api.example.test/api/wifi-management/devices' };
const token = 'synthetic-native-session-not-a-real-token';
function fixture(overrides = {}) {
  const getSession = jest.fn(async () => ({ data: { session: { access_token: token } } }));
  const fetchImpl = jest.fn(async () => response({ ok: true, state: { ...pendingWifiState('GPS-002'), integration: 'ready',
    reportedAt: new Date().toISOString(), wifiConnected: true, password: 'fixture-never-expose' } }));
  return { getSession, fetchImpl, service: createWifiStatusService({ config, getSession, fetchImpl, ...overrides }) };
}
function response(body, overrides = {}) {
  return { ok: true, headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    text: async () => JSON.stringify(body), ...overrides };
}

test('default/disabled service performs no session access or HTTP', async () => {
  const item = fixture({ config: { ...config, wifiStatusEnabled: false } });
  expect(await item.service.getState('GPS-002')).toEqual(pendingWifiState('GPS-002'));
  expect(item.getSession).not.toHaveBeenCalled(); expect(item.fetchImpl).not.toHaveBeenCalled();
});

test('enabled adapter sends only authenticated no-store GET and projects no secrets', async () => {
  const item = fixture();
  const state = await item.service.getState('GPS-002');
  expect(item.fetchImpl).toHaveBeenCalledWith(`${config.wifiStatusBaseUrl}/GPS-002`, expect.objectContaining({
    method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  }));
  expect(state).toMatchObject({ deviceId: 'GPS-002', integration: 'ready', wifiConnected: true });
  expect(JSON.stringify(state)).not.toContain('fixture-never-expose');
  expect(Object.keys(item.service)).toEqual(['getState']);
});

test('missing login fails closed without an HTTP request', async () => {
  const item = fixture({ getSession: async () => ({ data: { session: null } }) });
  await expect(item.service.getState('GPS-002')).rejects.toThrow('No device changes');
  expect(item.fetchImpl).not.toHaveBeenCalled();
});

test('unknown device fails before obtaining a token', async () => {
  const item = fixture();
  await expect(item.service.getState('GPS-003')).rejects.toThrow('Unsupported');
  expect(item.getSession).not.toHaveBeenCalled();
});

test.each([
  { ok: true, state: { ...pendingWifiState('GPS-001'), integration: 'ready' } },
  { ok: true, simulation: true, state: pendingWifiState('GPS-002') },
  { ok: true, state: { ...pendingWifiState('GPS-002'), simulation: true } },
  { ok: false, error: token },
])('mismatched/simulated/invalid report cannot become actual status', async (body) => {
  const item = fixture({ fetchImpl: async () => response(body) });
  await expect(item.service.getState('GPS-002')).rejects.toThrow('Wi-Fi status unavailable.');
});

test('HTML login/error pages and oversized responses are not accepted as status', async () => {
  for (const badResponse of [response({}, { headers: { get: () => 'text/html' } }),
    response({ ok: true, extra: 'x'.repeat(17000) })]) {
    const item = fixture({ fetchImpl: async () => badResponse });
    await expect(item.service.getState('GPS-002')).rejects.toThrow('Wi-Fi status unavailable.');
  }
});

test('expired report remains Unknown, rather than inventing a new connection time', async () => {
  const old = { ...pendingWifiState('GPS-002'), integration: 'ready', reportedAt: '2020-01-01T00:00:00Z', wifiConnected: true };
  const item = fixture({ fetchImpl: async () => response({ ok: true, state: old }) });
  const result = await item.service.getState('GPS-002');
  expect(result.reportedAt).toBe(old.reportedAt); // Existing presentation applies the 90s limit.
  expect(wifiStatusPresentation(result, Date.parse('2026-10-18T00:00:00Z')).wifi).toBe('Unknown');
});

test('abort while awaiting the session prevents a late HTTP request', async () => {
  let resolveSession;
  const session = new Promise((resolve) => { resolveSession = resolve; });
  const controller = new AbortController();
  const item = fixture({ getSession: () => session });
  const read = item.service.getState('GPS-002', { signal: controller.signal });
  controller.abort();
  await expect(read).rejects.toThrow('No device changes');
  resolveSession({ data: { session: { access_token: token } } });
  await Promise.resolve();
  expect(item.fetchImpl).not.toHaveBeenCalled();
});

test('an unresponsive transport is bounded without exposing its errors', async () => {
  jest.useFakeTimers();
  try {
    const item = fixture({ fetchImpl: () => new Promise(() => {}) });
    const assertion = expect(item.service.getState('GPS-002')).rejects.toThrow('Wi-Fi status unavailable.');
    jest.advanceTimersByTime(4501);
    await assertion;
  } finally { jest.useRealTimers(); }
});
