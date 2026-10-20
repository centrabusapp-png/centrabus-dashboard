import { deviceGpsSummary, setupAgeLabel } from './deviceSetupModel';

const now = Date.parse('2026-10-18T00:00:10Z');
const gps = { deviceId: 'GPS-001', latitude: 14.1, longitude: 121.1, gpsUpdatedAt: '2026-10-18T00:00:09Z', online: true };

test('exact device association, not bus array order, selects the correct source', () => {
  const rows = { second: { ...gps, deviceId: 'GPS-002', gpsUpdatedAt: '2026-10-17T00:00:00Z' }, first: gps };
  expect(deviceGpsSummary('GPS-001', rows, now)).toMatchObject({ busId: 'first', recent: true, ageSeconds: 1 });
  expect(deviceGpsSummary('GPS-002', rows, now)).toMatchObject({ busId: 'second', recent: false, label: 'Stale capture' });
  expect(deviceGpsSummary('GPS-001', { second: rows.second }, now).busId).toBeNull();
});

test('missing device metadata or conflicting associations is not guessed', () => {
  expect(deviceGpsSummary('GPS-001', { 'GPS-001': { ...gps, deviceId: undefined } }, now).label).toBe('No associated GPS data');
  expect(deviceGpsSummary('GPS-001', { a: gps, b: gps }, now)).toMatchObject({ label: 'Association conflict', recent: false, busId: null });
});

test.each([null, '', 'not-a-date', '2026-10-18T00:00:09', '2026-02-30T00:00:09Z', '2026-10-18T00:00:13Z'])('missing, malformed, local or excessive future capture time remains unverified: %s', (gpsUpdatedAt) => {
  expect(deviceGpsSummary('GPS-001', { a: { ...gps, gpsUpdatedAt, updatedAt: new Date(now).toISOString(), deviceUpdatedAt: now } }, now))
    .toMatchObject({ label: 'Capture time unverified', recent: false, ageSeconds: null });
});

test('fresh heartbeat cannot make a stale original capture fresh', () => {
  const result = deviceGpsSummary('GPS-001', { a: { ...gps, gpsUpdatedAt: '2026-10-17T00:00:00Z', deviceUpdatedAt: now } }, now);
  expect(result).toMatchObject({ label: 'Stale capture', capturedAt: '2026-10-17T00:00:00.000Z', recent: false });
});

test.each([{ latitude: 91 }, { longitude: NaN }, { longitude: 181 }, { latitude: null }])('invalid positions never become recent GPS data', (change) => {
  expect(deviceGpsSummary('GPS-001', { a: { ...gps, ...change } }, now)).toMatchObject({ label: 'Position unavailable', recent: false });
});

test.each([{ online: false }, { sourceUnavailable: true }, { gpsQuality: 'WEAK' }, { gpsQuality: 'INVALID' }])('unavailable or rejected quality cannot appear recent', (change) => {
  expect(deviceGpsSummary('GPS-001', { a: { ...gps, ...change } }, now).recent).toBe(false);
});

test('stationary capture and Postgres UTC offset are supported without inventing receiver lock', () => {
  const result = deviceGpsSummary('GPS-001', { a: { ...gps, rawSpeedKmh: 0, gpsUpdatedAt: '2026-10-18T00:00:09+00:00' } }, now);
  expect(result).toMatchObject({ label: 'Recent capture', recent: true, quality: null, satellites: null, accuracy: null });
  expect(result.detail).toContain('not a direct receiver test');
});

test.each([[null, 'Unknown'], [0, '0s ago'], [61, '1m ago'], [3700, '1h ago'], [90000, '1d ago']])('operator age label %s', (value, label) => {
  expect(setupAgeLabel(value)).toBe(label);
});
