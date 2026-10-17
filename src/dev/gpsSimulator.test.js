import { createGpsSimulator } from './gpsSimulator';

test('development simulator posts a GPS capture timestamp with each live fix', async () => {
  const originalFetch = global.fetch;
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });

  const simulator = createGpsSimulator('development-bus', { intervalMs: 60_000 });
  try {
    await simulator.start();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = global.fetch.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(payload.busId).toBe('development-bus');
    expect(payload.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(payload.updatedAt).toBeUndefined();
    expect(payload.rawSpeedKmh).toBe(payload.speed);
  } finally {
    await simulator.stop();
    global.fetch = originalFetch;
    logSpy.mockRestore();
  }
});
