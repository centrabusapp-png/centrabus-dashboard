import { rawGpsSpeed, rawGpsMotion } from './gpsMotion';
import { normalizeLiveGpsRecord, appendGpsSpeedSample } from './App';
import { normalizeGpsHistoryRow } from './records/gpsHistory';
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('react-leaflet', () => ({}));

test.each([
  [{ speed: 0, rawSpeedKmh: 25, motionStatus: 'STOPPED', movement2sM: 5 }, 'MOVING'],
  [{ speed: 40, rawSpeedKmh: 0.7, motionStatus: 'MOVING', movement6sM: 0.5 }, 'STOPPED'],
  [{ speed: 0, rawSpeedKmh: 4, movement6sM: 0.5 }, 'UNKNOWN'],
  [{ speed: 25, rawSpeedKmh: 25 }, 'UNKNOWN'],
  [{ rawSpeedKmh: 25, movement2sM: 5, gpsQuality: 'WEAK' }, 'UNKNOWN'],
  [{ rawSpeedKmh: 25, movement2sM: 5, horizontalAccuracyM: 16 }, 'UNKNOWN'],
])('motion ignores final speed/filter status and requires GPS evidence %#', (gps, expected) => {
  expect(rawGpsMotion(gps)).toBe(expected);
});

test('missing/invalid raw speed never falls back to final speed or fabricates zero', () => {
  for (const gps of [null, {}, { speed: 35 }, { rawSpeedKmh: null }, { rawSpeedKmh: '' }, { rawSpeedKmh: true }, { rawSpeedKmh: -1 }, { rawSpeedKmh: 251 }]) {
    expect(rawGpsSpeed(gps)).toBeNull();
    expect(rawGpsMotion(gps)).toBe('UNKNOWN');
  }
});

test('live/history normalization and rolling graph contain raw speed, not final speed', () => {
  const normalized = normalizeLiveGpsRecord({ speed: 0, rawSpeedKmh: 25, movement2sM: 5, gpsUpdatedAt: 1000 });
  expect(normalized).toMatchObject({ speed: 25, motionStatus: 'MOVING' });
  expect(appendGpsSpeedSample([], normalized)).toEqual([{ timestamp: 1000, rawSpeed: 25 }]);
  expect(normalizeGpsHistoryRow({ speed: 0, diagnostics: { raw_speed_kmh: 25, movement_2s_m: 5, motion_status: 'STOPPED' } })).toMatchObject({ speed: 25, motionStatus: 'MOVING' });
  expect(normalizeGpsHistoryRow({ speed: 35 })).toMatchObject({ speed: null, motionStatus: 'UNKNOWN' });
});
