import { cameraReadingsFeatureEnabled, deriveCameraPanel, validCameraCalibration } from './cameraReadings';
import { createSupabaseCameraReadingsService } from './cameraReadingsService';
import { cameraSnapshot, TEST_CALIBRATION as CAL, TEST_TIME as TIME } from './testing/fixtures';

test('mixed source epochs are withheld instead of appearing as one six-gauge capture', () => {
  const snapshot = cameraSnapshot(); const first = snapshot.readings[0];
  snapshot.readings.push({ ...first, gauge_key: 'oilPressure', captured_at: new Date(TIME - 2000).toISOString() });
  expect(deriveCameraPanel(snapshot, 'test-bus', CAL, TIME).status).toBe('Invalid');
});
const derive = (snapshot = cameraSnapshot(), policy = CAL, now = TIME) => deriveCameraPanel(snapshot, 'test-bus', policy, now);
test('camera feature is default-OFF; only explicit true opts in', () => {
  for (const value of [undefined, '', 'false', 'TRUE', true, '1']) expect(cameraReadingsFeatureEnabled(value)).toBe(false);
  expect(cameraReadingsFeatureEnabled('true')).toBe(true);
});
test('missing calibration has no inferred units/zero/Normal or alerts', () => {
  const state = derive(cameraSnapshot(), null); expect(state.status).toBe('Awaiting Data'); expect(state.gauges).toEqual([]);
  expect(validCameraCalibration({ ...CAL, approved: false })).toBe(false);
});
test('validated numerical DTO retains original capture time, confidence and unit', () => {
  const state = derive(); expect(state.status).toBe('Reading Available');
  expect(state.gauges[0]).toMatchObject({ numericValue: 42, confidence: 0.95, unit: 'fixture-unit', ageMs: 1000,
    capturedAt: new Date(TIME - 1000).toISOString(), status: 'Reading Available' });
  expect(state.gauges[1]).toMatchObject({ gaugeKey: 'oilPressure', label: 'Oil gauge (meaning unconfirmed)', status: 'Awaiting Data' });
  expect(state.gauges[1].numericValue).toBeUndefined();
});
test('fresh receipt/processing cannot freshen stale original capture', () => {
  const state = derive(cameraSnapshot({ captured_at: new Date(TIME - 60_000).toISOString() }));
  expect(state.status).toBe('Stale'); expect(state.gauges[0].numericValue).toBe(42); expect(state.gauges[0].ageMs).toBe(60_000);
});
test('low confidence remains Awaiting Data instead of zero/Normal', () => {
  const state = derive(cameraSnapshot({ confidence: 0.2 })); expect(state.status).toBe('Awaiting Data');
  expect(state.gauges.every((gauge) => gauge.numericValue === undefined)).toBe(true);
});
test.each([
  ['bus mismatch', { bus_id: 'other' }], ['camera mismatch', { camera_id: 'other' }],
  ['unknown key', { gauge_key: 'tpms' }], ['wrong units', { unit: '%' }],
  ['inherited object key', { gauge_key: 'toString', unit: undefined }], ['excess numeric precision', { numeric_value: 42.0000001 }],
  ['NaN', { numeric_value: NaN }], ['infinity', { numeric_value: Infinity }],
  ['blank numeric', { numeric_value: '' }], ['hex numeric', { numeric_value: '0x2a' }],
  ['out of range', { numeric_value: 101 }], ['confidence invalid', { confidence: 1.1 }],
  ['bad timestamp', { captured_at: 'invalid' }], ['missing capture', { captured_at: undefined }],
  ['calendar overflow', { captured_at: '2026-02-30T04:00:00Z' }],
  ['future capture', { captured_at: new Date(TIME + 5000).toISOString() }],
  ['future processed', { processed_at: new Date(TIME + 5000).toISOString() }],
  ['processing before receipt', { processed_at: new Date(TIME - 2000).toISOString() }],
  ['unapproved version', { algorithm_version: 'different' }], ['fake model', { model_artifact_version: 'fake' }],
  ['unsupported status', { result_status: 'Normal' }], ['worker severity leakage', { severity: 'Critical' }],
])('invalid DTO: %s', (name, change) => { expect(derive(cameraSnapshot(change)).status).toBe('Invalid'); });
test('small future capture skew allowed but never negative age', () => {
  const state = derive(cameraSnapshot({ captured_at: new Date(TIME + 1000).toISOString() }));
  expect(state.status).toBe('Reading Available'); expect(state.gauges[0].ageMs).toBe(0);
});
test('duplicate gauges rejected; partial rows never fabricated', () => {
  const snapshot = cameraSnapshot(); snapshot.readings.push(snapshot.readings[0]); expect(derive(snapshot).status).toBe('Invalid');
  expect(derive({ ...cameraSnapshot(), readings: [] }).status).toBe('Awaiting Data');
});
test('multiple camera ambiguity detected even with zero readings', () => {
  const snapshot = cameraSnapshot(); snapshot.cameras.push({ camera_id: 'TEST-CAM-2', bus_id: 'test-bus', enabled: true }); snapshot.readings = [];
  expect(derive(snapshot).status).toBe('Invalid'); expect(derive(snapshot).message).toMatch(/Multiple cameras/);
});
test('unassigned/disabled cameras and changed association do not yield values', () => {
  expect(derive({ cameras: [], readings: [] }).status).toBe('Awaiting Data');
  expect(derive({ cameras: [{ camera_id: 'TEST-CAM-1', bus_id: 'test-bus', enabled: false }], readings: [] }).status).toBe('Awaiting Data');
  expect(derive({ cameras: [{ camera_id: 'TEST-CAM-1', bus_id: 'other-bus', enabled: true }], readings: [] }).status).toBe('Invalid');
});

function mockClient(results) {
  const queries = [];
  const client = { from: jest.fn((table) => {
    const query = { table, columns: null, filters: [], limit: null }; queries.push(query);
    const builder = { select: (columns) => { query.columns = columns; return builder; },
      eq: (key, value) => { query.filters.push([key, value]); return builder; }, order: () => builder,
      limit: (limit) => { query.limit = limit; return builder; }, abortSignal: (signal) => { query.signal = signal; return builder; },
      then: (resolve, reject) => Promise.resolve(results.shift()).then(resolve, reject) };
    return builder;
  }) };
  return { client, queries };
}
test('Supabase adapter default blocks all queries/writes until separate approval', async () => {
  const { client } = mockClient([]); await expect(createSupabaseCameraReadingsService({ client }).readLatest('test-bus')).rejects.toThrow();
  expect(client.from).not.toHaveBeenCalled();
});
test('read adapter only bounded safe-column native-session reads; assignment rechecked', async () => {
  const snapshot = cameraSnapshot(); const signal = new AbortController().signal;
  const { client, queries } = mockClient([{ data: snapshot.cameras }, { data: snapshot.readings }, { data: snapshot.cameras }]);
  const result = await createSupabaseCameraReadingsService({ client, approved: true }).readLatest('test-bus', { signal });
  expect(result).toEqual(snapshot); expect(queries.map((query) => query.limit)).toEqual([3, 7, 3]);
  expect(queries.every((query) => query.filters.some(([key, value]) => key === 'bus_id' && value === 'test-bus'))).toBe(true);
  expect(queries.every((query) => !query.columns.includes('*') && !query.columns.includes('image_sha256') && !query.columns.includes('metadata'))).toBe(true);
  expect(queries.every((query) => query.signal === signal)).toBe(true);
});
test('ambiguous assignment makes no view query', async () => {
  const cameras = [...cameraSnapshot().cameras, { camera_id: 'TEST-CAM-2', bus_id: 'test-bus', enabled: true }];
  const { client } = mockClient([{ data: cameras }]); const result = await createSupabaseCameraReadingsService({ client, approved: true }).readLatest('test-bus');
  expect(result).toEqual({ cameras, readings: [] }); expect(client.from).toHaveBeenCalledTimes(1);
});
test('reassignment during read fails instead of returning another bus data', async () => {
  const snapshot = cameraSnapshot(); const { client } = mockClient([{ data: snapshot.cameras }, { data: snapshot.readings }, { data: [] }]);
  await expect(createSupabaseCameraReadingsService({ client, approved: true }).readLatest('test-bus')).rejects.toThrow('camera-assignment-changed');
});
test('network/RLS denied read is unavailable, not fallback synthetic telemetry', async () => {
  const { client } = mockClient([{ error: new Error('test-only') }]);
  await expect(createSupabaseCameraReadingsService({ client, approved: true }).readLatest('test-bus')).rejects.toThrow('camera-read-unavailable');
});
