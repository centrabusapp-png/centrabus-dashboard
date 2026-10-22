import { createCameraReadingsCsv } from './cameraReadingsCsv';
import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel';
const NOW = Date.parse('2026-10-22T04:00:00.000Z');
const fixture = () => ({ device_id: 'GPS-002', camera_id: 'test-camera', bus_id: 'test-bus', capture_id: 'source:5',
  captured_at: new Date(NOW - 1000).toISOString(), readings: LIVE_GAUGE_KEYS.map((gauge_key) => ({ gauge_key,
    quality: gauge_key === 'rearAir' ? 'uncertain' : 'detected', value: gauge_key === 'rearAir' ? null : gauge_key === 'coolant' ? 0 : 34.12,
    angle_deg: gauge_key === 'rearAir' ? null : 103.24, dial_percent: gauge_key === 'rearAir' ? null : 34.12,
    unit: ['frontAir', 'rearAir'].includes(gauge_key) ? 'kg/cm2' : '%' })) });
const exportFrame = (frame, extra = {}) => createCameraReadingsCsv({ frame, deviceId: 'GPS-002', state: 'live', now: NOW, ...extra });

test('CSV has the same six source readings in physical order, original angles/time, no fabricated rejected values', () => {
  const frame = fixture(); const original = JSON.stringify(frame); const result = exportFrame(frame);
  const rows = result.csv.trim().split('\r\n');
  expect(result.blob.type).toBe('text/csv;charset=utf-8');
  expect(result.filename).toMatch(/^centrabus-GPS-002-readings-.*\.csv$/);
  expect(rows).toHaveLength(7);
  expect(rows[0]).toContain('"captured_at_utc","exported_at_utc"');
  expect(rows.slice(1).map(row => row.split(',')[6])).toEqual(['"Fuel"','"Coolant"','"Front air pressure"','"Rear air pressure"','"Battery"','"Oil"']);
  expect(rows[1]).toContain('"103.24"');
  expect(rows[1]).toContain(`"${frame.captured_at}","${new Date(NOW).toISOString()}"`);
  expect(rows[2]).toContain('"detected","0","%"'); // True detected zero is not missing data.
  expect(rows[4]).toContain('"uncertain","","kg/cm2","","","unverified"');
  expect(JSON.stringify(frame)).toBe(original);
});
test.each([-3000, 16000, NaN])('rejects unsafe capture age %s', (age) => {
  const frame = fixture(); frame.captured_at = Number.isNaN(age) ? 'invalid' : new Date(NOW - age).toISOString();
  expect(() => exportFrame(frame)).toThrow('csv-source-unavailable');
});
test('rejects wrong devices, last-known frames, duplicate/missing gauges and invalid rejected numbers', () => {
  expect(() => exportFrame(fixture(), { deviceId: 'GPS-001' })).toThrow();
  expect(() => exportFrame(fixture(), { state: 'last-known' })).toThrow();
  const duplicate = fixture(); duplicate.readings[1] = duplicate.readings[0]; expect(() => exportFrame(duplicate)).toThrow();
  const missing = fixture(); missing.readings.pop(); expect(() => exportFrame(missing)).toThrow();
  const fabricated = fixture(); fabricated.readings[3].value = 0; expect(() => exportFrame(fabricated)).toThrow();
});
test('quotes identifiers and neutralizes spreadsheet formula injection', () => {
  const frame = fixture(); frame.bus_id = '=HYPERLINK("https://example.invalid")';
  const result = exportFrame(frame);
  expect(result.csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
});
