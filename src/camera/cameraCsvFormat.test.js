import { CAMERA_CSV_COLUMNS, CAMERA_CSV_DETAIL_COLUMNS, cameraCsvTable } from './cameraCsvFormat';
import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel';

const NOW = Date.parse('2026-10-25T02:00:00.000Z');
const fixture = () => ({ device_id: 'GPS-001', camera_id: 'CAM-001', bus_id: 'bus-one',
  capture_id: 'camera:42', captured_at: '2026-10-24T16:00:00.123Z', received_at: '2026-10-24T16:00:01.234Z',
  processor_version: 'synthetic-detector', readings: LIVE_GAUGE_KEYS.map(gauge_key => ({ gauge_key,
    quality: gauge_key === 'rearAir' ? 'uncertain' : 'detected', value: gauge_key === 'rearAir' ? null : 0,
    angle_deg: gauge_key === 'rearAir' ? null : 90, dial_percent: gauge_key === 'rearAir' ? null : 0 })) });

test('compact report has one labelled row per capture with the six values in physical-panel order', () => {
  const frame = fixture(), before = JSON.stringify(frame);
  const result = cameraCsvTable({ frames: [frame], busLabel: 'BUS 04', now: NOW });
  expect(result.columns).toEqual(CAMERA_CSV_COLUMNS);
  expect(result.columns).toHaveLength(11);
  expect(result.rows).toEqual([['2026-10-25', '12:00:00 AM PHT', 'BUS 04', 'Pi1 (GPS-001)',
    0, 0, 0, null, 0, 0, 5]]);
  expect(result.csv).not.toMatch(/Uncertain|Not verified|Physical accuracy|Missing or uncertain/);
  expect(result.csv.startsWith('\uFEFF"Date (Philippines)"')).toBe(true);
  expect(result.csv).toContain('"Front air pressure (kg/cm²)","Rear air pressure (kg/cm²)"');
  expect(result.csv).not.toMatch(/camera:42|synthetic-detector/);
  expect(JSON.stringify(frame)).toBe(before);
});

test('technical fields follow the simple report and retain exact IDs, angles, dial positions and original UTC epochs', () => {
  const frame = fixture(), result = cameraCsvTable({ frames: [frame], includeDetails: true, now: NOW });
  expect(result.columns).toEqual([...CAMERA_CSV_COLUMNS, ...CAMERA_CSV_DETAIL_COLUMNS]);
  expect(new Set(result.columns).size).toBe(result.columns.length);
  const row = Object.fromEntries(result.columns.map((column, index) => [column, result.rows[0][index]]));
  expect(row['Capture ID']).toBe(frame.capture_id);
  expect(row['Captured at (UTC)']).toBe(frame.captured_at);
  expect(row['Received by backend (UTC)']).toBe(frame.received_at);
  expect(row['Exported at (UTC)']).toBe(new Date(NOW).toISOString());
  expect(row['Fuel needle angle (deg)']).toBe(90);
  expect(row['Rear air pressure detection status']).toBe('Uncertain');
  expect(row['Unavailable readings']).toBe('Rear air pressure: Uncertain');
  expect(row['Rear air pressure needle angle (deg)']).toBeNull();
  expect(result.rows[0]).toHaveLength(result.columns.length);
});

test('unknown, undetected and angle-only gauges are distinguished without a false zero or old value', () => {
  const frame = fixture();
  Object.assign(frame.readings[0], { value: null, dial_percent: null });
  Object.assign(frame.readings[1], { quality: 'undetected', value: null, angle_deg: null, dial_percent: null });
  const { rows } = cameraCsvTable({ frames: [frame], includeDetails: true, now: NOW });
  expect(rows[0].slice(4, 10)).toEqual([null, null, 0, null, 0, 0]);
  expect(rows[0][10]).toBe(3);
  expect(rows[0][11]).toBe('Fuel: Angle only; no supported value; Coolant: Not detected; Rear air pressure: Uncertain');
});

test('spreadsheet formulas, commas, quotes and newlines in identities are escaped as text', () => {
  const frame = fixture(); frame.capture_id = '\t=HYPERLINK("bad")';
  const { csv } = cameraCsvTable({ frames: [frame], busLabel: 'BUS, "special"\n04', includeDetails: true, now: NOW });
  expect(csv).toContain('"BUS, ""special""\n04"');
  expect(csv).toContain('"\'\t=HYPERLINK(""bad"")"');
});
