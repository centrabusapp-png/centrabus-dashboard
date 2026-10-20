import { checkSetupBackend } from './setupConnectionService';
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const config = { configured: true, origin: 'http://localhost:5000', healthUrl: 'http://localhost:5000/health' };
const response = (body, extras = {}) => ({ ok: true, headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
  text: async () => JSON.stringify(body), ...extras });

test('explicit check sends one credential-free, read-only GET to the configured API', async () => {
  const fetchImpl = jest.fn(async () => response({ ok: true, secret: 'do-not-project' }));
  const result = await checkSetupBackend({ config, fetchImpl });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledWith(config.healthUrl, expect.objectContaining({ method: 'GET', cache: 'no-store',
    credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } }));
  expect(result).toEqual({ reachable: true, checkedAt: expect.any(Number) });
});

test.each([{}, { ...config, configured: false }, { ...config, healthUrl: 'http://another-host/health' }])('invalid configuration performs no request', async (value) => {
  const fetchImpl = jest.fn();
  await expect(checkSetupBackend({ config: value, fetchImpl })).rejects.toThrow('not configured');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each([response({ ok: false }), response({ ok: true, simulation: true }), response({ ok: true }, { ok: false }),
  response({}, { headers: { get: () => 'text/html' } }), response({ extra: 'x'.repeat(17000) }),
  response({}, { headers: { get: (name) => name === 'content-type' ? 'application/json' : '17000' } })])('bad, simulated or oversized health cannot become success', async (value) => {
  await expect(checkSetupBackend({ config, fetchImpl: async () => value })).rejects.toThrow('No device changes');
});

test('oversized streaming response is cancelled', async () => {
  const reader = { read: jest.fn(async () => ({ done: false, value: new Uint8Array(17000) })), cancel: jest.fn(async () => {}), releaseLock: jest.fn() };
  await expect(checkSetupBackend({ config, fetchImpl: async () => response({}, { body: { getReader: () => reader } }) })).rejects.toThrow('No device changes');
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});

test('timeout bounds even a hung fetch without leaking transport errors', async () => {
  jest.useFakeTimers();
  try {
    const fetchImpl = jest.fn(() => new Promise(() => {}));
    const assertion = expect(checkSetupBackend({ config, fetchImpl })).rejects.toThrow('No device changes');
    jest.advanceTimersByTime(4501);
    await assertion;
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  } finally { jest.useRealTimers(); }
});

test('already-aborted and midflight cancellation cannot report success', async () => {
  const already = new AbortController(); already.abort();
  const fetchImpl = jest.fn();
  await expect(checkSetupBackend({ config, signal: already.signal, fetchImpl })).rejects.toThrow('No device changes');
  expect(fetchImpl).not.toHaveBeenCalled();
  const controller = new AbortController();
  const assertion = expect(checkSetupBackend({ config, signal: controller.signal, fetchImpl: () => new Promise(() => {}) })).rejects.toThrow('No device changes');
  controller.abort();
  await assertion;
});
