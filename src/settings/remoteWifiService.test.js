import { createRemoteWifiService, pendingRemoteWifiService, remoteWifiState } from './remoteWifiService';
const { TextEncoder } = require('node:util');
beforeAll(() => { global.TextEncoder = TextEncoder; });
const report = { protocolVersion: 2, sessionId: 'session-fixture', sequence: 1, observedAt: 1000, connectEnabled: true, publicKey: 'synthetic-public-key',
  savedProfiles: [], profilesStatus: 'not_checked', profilesObservedAt: null, networksObservedAt: 1000,
  wifiConnected: true, internet: 'full', task: 'idle', trialId: null, deadline: null,
  networks: [{ id: 'network-test', ssid: 'Synthetic Depot', security: 'wpa2-personal', signal: 80, connected: false }], lastResult: null };
const body = { ok: true, deviceId: 'GPS-002', online: true, serverTime: 1000, receivedAt: 1000, report, pendingCommandId: null };
function fixture(options = {}) {
  const fetchImpl = jest.fn(async (url, init) => ({ ok: true, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(init.method === 'GET' ? body : { ok: true, commandId: 'command-test' }) }));
  const encrypt = jest.fn(async () => 'encrypted-only');
  const service = createRemoteWifiService({ config: { configured: true, origin: 'http://192.168.1.5:5000', remoteWifiEnabled: true },
    getSession: async () => ({ data: { session: { access_token: 'synthetic-admin' } } }), fetchImpl, encrypt, ...options });
  return { service, fetchImpl, encrypt };
}
test('remote transport is opt-in and invalid/cross-device/stale states fail closed', () => {
  expect(createRemoteWifiService({ config: {} })).toBe(pendingRemoteWifiService);
  expect(remoteWifiState(body, 'GPS-002').online).toBe(true);
  expect(() => remoteWifiState(body, 'GPS-001')).toThrow();
  expect(() => remoteWifiState({ ...body, serverTime: 17000 }, 'GPS-002')).toThrow();
  expect(remoteWifiState({ ...body, online: false }, 'GPS-002').report).toBeNull();
  expect(remoteWifiState({ ...body, serverTime: 11000, report: { ...report, observedAt: 12000 } }, 'GPS-002').remainingMs).toBe(5000);
});
test('native admin session is required; requests forbid redirects/cookies and plaintext passwords', async () => {
  const { service, fetchImpl, encrypt } = fixture();
  const state = await service.read('GPS-002');
  const payload = { networkId: 'network-test', priority: 50, password: 'synthetic-password' };
  await service.command(state, 'connect', payload, { commandId: 'command-test' });
  expect(payload.password).toBe('');
  expect(encrypt).toHaveBeenCalledWith(expect.objectContaining({ label: 'centrabus-remote-wifi-v1:GPS-002:session-fixture:command-test' }));
  const [url, init] = fetchImpl.mock.calls[1]; expect(url).toBe('/api/wifi-remote/devices/GPS-002/commands');
  expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
  expect(init.body).not.toContain('synthetic-password'); expect(init.body).toContain('encrypted-only');
  expect(init.headers.Authorization).toBe('Bearer synthetic-admin');
});
test('missing auth and failed encryption never deliver a command or expose a secret', async () => {
  const f = fixture({ getSession: async () => ({}) });
  await expect(f.service.read('GPS-002')).rejects.toThrow('unavailable'); expect(f.fetchImpl).not.toHaveBeenCalled();
  const bad = fixture({ encrypt: async () => { throw new Error('synthetic-private-error'); } });
  const payload = { password: 'synthetic-password', networkId: 'network-test', priority: 50 };
  await expect(bad.service.command(remoteWifiState(body, 'GPS-002'), 'connect', payload, { commandId: 'command-test' })).rejects.toThrow();
  expect(payload.password).toBe(''); expect(bad.fetchImpl).not.toHaveBeenCalled();
});
test('device change/abort during encryption prevents late command delivery', async () => {
  let finish; const f = fixture({ encrypt: () => new Promise((resolve) => { finish = resolve; }) });
  const controller = new AbortController();
  const outcome = f.service.command(remoteWifiState(body, 'GPS-002'), 'connect', { password: 'synthetic-password', networkId: 'network-test', priority: 50 },
    { commandId: 'command-test', signal: controller.signal });
  controller.abort(); finish('encrypted-only');
  await expect(outcome).rejects.toThrow('Cancelled'); expect(f.fetchImpl).not.toHaveBeenCalled();
});
test('hung session lookup has a six-second deadline and no late fetch', async () => {
  jest.useFakeTimers();
  try {
    let finish; const f = fixture({ getSession: () => new Promise((resolve) => { finish = resolve; }) });
    const result = expect(f.service.read('GPS-002')).rejects.toThrow('unavailable');
    jest.advanceTimersByTime(6001); await result;
    finish({ data: { session: { access_token: 'late' } } }); await Promise.resolve();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('hung password encryption is bounded, clears the payload and cannot send late', async () => {
  jest.useFakeTimers();
  try {
    let finish; const f = fixture({ encrypt: () => new Promise((resolve) => { finish = resolve; }) });
    const payload = { password: 'synthetic-password', networkId: 'network-test', priority: 50 };
    const result = expect(f.service.command(remoteWifiState(body, 'GPS-002'), 'connect', payload, { commandId: 'command-test' })).rejects.toThrow('Cancelled');
    jest.advanceTimersByTime(6001); await result;
    expect(payload.password).toBe(''); finish('encrypted-only'); await Promise.resolve();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('duplicate scan IDs, invalid UTF-8 SSID length and extra response fields fail closed or are projected out', () => {
  expect(() => remoteWifiState({ ...body, report: { ...report, networks: [report.networks[0], report.networks[0]] } }, 'GPS-002')).toThrow();
  expect(() => remoteWifiState({ ...body, report: { ...report, networks: [{ ...report.networks[0], ssid: 'é'.repeat(17) }] } }, 'GPS-002')).toThrow();
  const value = remoteWifiState({ ...body, report: { ...report, password: 'synthetic-extra' } }, 'GPS-002');
  expect(JSON.stringify(value)).not.toContain('synthetic-extra');
});

const profile = { profileId: '22222222-2222-4222-8222-222222222222', profileVersion: 'a'.repeat(64), ssid: 'Synthetic Hotspot',
  priority: 50, security: 'wpa2-personal', signal: 90, available: true, connected: false };
test('saved-profile commands carry UUID/version only, without encryption or plaintext credentials', async () => {
  const f = fixture(); const r = { ...report, savedProfiles: [profile], profilesStatus: 'ready', profilesObservedAt: 1000 };
  const state = remoteWifiState({ ...body, report: r }, 'GPS-002');
  await f.service.command(state, 'connect_saved', { profileId: profile.profileId, profileVersion: profile.profileVersion }, { commandId: 'command-test' });
  expect(f.encrypt).not.toHaveBeenCalled(); const envelope = JSON.parse(f.fetchImpl.mock.calls[0][1].body);
  expect(envelope.payload).toEqual({ profileId: profile.profileId, profileVersion: profile.profileVersion });
  expect(state.profilesRemainingMs).toBe(60000); expect(state.scanRemainingMs).toBe(60000);
});
test('saved results sort by current connection/availability/strength and expire without refreshing capture age', () => {
  const weak = { ...profile, profileId: '33333333-3333-4333-8333-333333333333', signal: 30 };
  const r = { ...report, savedProfiles: [weak, profile], profilesStatus: 'ready', profilesObservedAt: 1000 };
  const value = remoteWifiState({ ...body, serverTime: 9000, receivedAt: 9000, report: { ...r, observedAt: 9000 } }, 'GPS-002');
  expect(value.report.savedProfiles[0].profileId).toBe(profile.profileId); expect(value.profilesRemainingMs).toBe(52000);
  expect(() => remoteWifiState({ ...body, report: { ...r, savedProfiles: [profile, profile] } }, 'GPS-002')).toThrow();
  expect(() => remoteWifiState({ ...body, report: { ...r, protocolVersion: 1 } }, 'GPS-002')).toThrow();
});
