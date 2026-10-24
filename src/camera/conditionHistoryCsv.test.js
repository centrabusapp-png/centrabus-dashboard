import { buildConditionHistoryCsv, conditionPeriod, createConditionHistoryService, defaultConditionPeriod } from './conditionHistoryCsv';
import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel';
const NOW = Date.parse('2026-10-23T04:00:00.000Z');
const range = { from: '2026-10-22T16:00:00.000Z', to: new Date(NOW).toISOString() };
const fixture = (capture = 'trip:1') => ({ device_id: 'GPS-002', camera_id: 'test-camera', bus_id: 'test-bus',
  capture_id: capture, captured_at: '2026-10-23T01:02:03.000Z', received_at: '2026-10-23T01:02:04.000Z',
  processor_version: 'test-version', interpretation: 'unverified', calibration_verified: false,
  readings: LIVE_GAUGE_KEYS.map(gauge_key => ({ gauge_key, quality: gauge_key === 'rearAir' ? 'uncertain' : 'detected',
    value: gauge_key === 'rearAir' ? null : 0, angle_deg: gauge_key === 'rearAir' ? null : 92,
    dial_percent: gauge_key === 'rearAir' ? null : 0, unit: ['frontAir','rearAir'].includes(gauge_key) ? 'kg/cm2' : '%' })) });
const page = (frames = [fixture()], extra = {}) => ({ ok: true, busId: 'test-bus', ...range,
  snapshot: new Date(NOW).toISOString(), frames, nextCursor: null, ...extra });
const response = body => ({ ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
function service(fetchImpl, extra = {}) {
  return createConditionHistoryService({ config: { configured: true, origin: 'https://api.example.test' },
    development: true, getSession: async () => ({ data: { session: { access_token: 'synthetic-admin' } } }), fetchImpl, ...extra });
}
const request = extra => ({ busId: 'test-bus', busLabel: 'BUS 159', ...range, now: NOW, ...extra });

test('Philippine trip inputs handle midnight and reject invalid dates/reversed/oversized ranges', () => {
  expect(defaultConditionPeriod(Date.parse('2026-10-22T17:10:11Z'))).toEqual({ from: '2026-10-23T00:00:00', to: '2026-10-23T01:10:11' });
  expect(conditionPeriod('2026-10-23T00:00', '2026-10-23T12:00')).toEqual(range);
  for (const period of [['2026-02-30T01:00', '2026-03-01T01:00'], ['bad','bad'],
    ['2026-10-23T12:00','2026-10-23T00:00'], ['2026-01-01T00:00','2026-10-23T12:00']]) expect(() => conditionPeriod(...period)).toThrow();
});

test('exports historical captures, all six gauges, true zeroes and blank uncertain values without images', () => {
  const frame = fixture(), original = JSON.stringify(frame);
  const result = buildConditionHistoryCsv({ ...request(), frames: [frame, fixture('trip:2')], snapshot: range.to });
  expect(result.rows).toBe(12); expect(result.captures).toBe(2);
  expect(result.csv.trim().split('\r\n')).toHaveLength(13);
  expect(result.csv).toContain('"2026-10-23T01:02:03.000Z","2026-10-23T09:02:03+08:00"');
  expect(result.csv).toContain('"detected","0","%","92","0"');
  expect(result.csv).toContain('"Rear air pressure","uncertain","","kg/cm2","",""');
  expect(result.csv).not.toMatch(/base64|Bearer|image\/jpeg/);
  expect(result.filename).toMatch(/^centrabus-BUS-159-condition-.*\.csv$/);
  expect(JSON.stringify(frame)).toBe(original);
});

test('neutralizes formula identities and rejects duplicate, cross-bus, outside-period or fabricated readings', () => {
  const base = { ...request({ busLabel: '=HYPERLINK("bad")' }), frames: [fixture()], snapshot: range.to };
  expect(buildConditionHistoryCsv(base).csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(() => buildConditionHistoryCsv({ ...base, frames: [fixture(), fixture()] })).toThrow();
  expect(() => buildConditionHistoryCsv({ ...base, busId: 'other-bus' })).toThrow();
  expect(() => buildConditionHistoryCsv({ ...base, from: range.to })).toThrow();
  const bad = fixture(); bad.readings.find(r => r.gauge_key === 'rearAir').value = 0;
  expect(() => buildConditionHistoryCsv({ ...base, frames: [bad] })).toThrow();
});

test('retrieves every page with one pinned snapshot and original bus/range; development bearer stays on same origin', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(page([fixture()], { nextCursor: 'cursor1' })))
    .mockResolvedValueOnce(response(page([fixture('trip:2')])));
  const progress = jest.fn(), result = await service(fetchImpl).exportCsv(request({ onProgress: progress }));
  expect(result.captures).toBe(2); expect(progress.mock.calls).toEqual([[1],[2]]);
  const [url, options] = fetchImpl.mock.calls[1];
  expect(url).toMatch(/^\/api\/camera-frames\/buses\/test-bus\/history\?/);
  const params = new URL(url, 'http://localhost').searchParams;
  expect(params.get('snapshot')).toBe(range.to); expect(params.get('cursor')).toBe('cursor1');
  expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer synthetic-admin' } });
});

test('production targets only configured HTTPS backend, not the laptop proxy', async () => {
  const fetchImpl = jest.fn(async () => response(page()));
  await service(fetchImpl, { development: false }).exportCsv(request());
  expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/api.example.test\/api\/camera-frames\//);
  expect(service(fetchImpl, { development: false, config: { configured: true, origin: 'http://192.168.1.2:5000' } }).enabled).toBe(false);
});

test.each([[404, 'history-route-unavailable'], [429, 'history-rate-limited'], [503, 'history-unavailable'],
  [401, 'history-sign-in-required'], [403, 'history-sign-in-required']])('HTTP %s is distinguished without exporting partial data', async (status, reason) => {
  await expect(service(async () => ({ ok: false, status })).exportCsv(request())).rejects.toThrow(reason);
});

test('empty history, later-page failures, changed snapshots and repeated captures never produce partial CSV', async () => {
  await expect(service(async () => response(page([]))).exportCsv(request())).rejects.toThrow('history-empty');
  const failed = jest.fn().mockResolvedValueOnce(response(page([fixture()], { nextCursor: 'cursor1' }))).mockRejectedValueOnce(Error('offline'));
  await expect(service(failed).exportCsv(request())).rejects.toThrow();
  const repeated = jest.fn(async () => response(page([fixture()], { nextCursor: 'cursor1' })));
  await expect(service(repeated).exportCsv(request())).rejects.toThrow();
  const changed = jest.fn().mockResolvedValueOnce(response(page([fixture()], { nextCursor: 'cursor1' })))
    .mockResolvedValueOnce(response(page([fixture('trip:2')], { snapshot: '2026-10-23T04:00:01.000Z' })));
  await expect(service(changed).exportCsv(request())).rejects.toThrow();
});

test('abort before request does not fetch or export, and missing authorization fails closed', async () => {
  const controller = new AbortController(); controller.abort(); const fetchImpl = jest.fn();
  await expect(service(fetchImpl).exportCsv(request({ signal: controller.signal }))).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(service(fetchImpl, { getSession: async () => ({ data: {} }) }).exportCsv(request())).rejects.toThrow('history-sign-in-required');
  expect(fetchImpl).not.toHaveBeenCalled();
});
