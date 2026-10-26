import { LIVE_GAUGE_KEYS, LIVE_GAUGE_TITLES } from './liveCameraGaugeModel.js';
import { csvCell, philippineCsvTime } from '../utils/csvFormat.js';

const QUALITY_LABELS = { detected: 'Detected', uncertain: 'Uncertain', undetected: 'Not detected' };

// A CSV has no column-width/freeze-pane formatting. Keep the normal report
// compact, put units in headers, and keep optional technical fields at the end.
export const CAMERA_CSV_COLUMNS = [
  'Date (Philippines)', 'Time (UTC+08:00)', 'Bus', 'Device',
  'Fuel (%)', 'Coolant (%)', 'Front air pressure (kg/cm²)', 'Rear air pressure (kg/cm²)',
  'Battery (%)', 'Oil (%)', 'Readings available (out of 6)',
];
export const CAMERA_CSV_DETAIL_COLUMNS = [
  'Unavailable readings',
  ...LIVE_GAUGE_KEYS.flatMap(key => [
    `${LIVE_GAUGE_TITLES[key]} detection status`, `${LIVE_GAUGE_TITLES[key]} needle angle (deg)`,
    `${LIVE_GAUGE_TITLES[key]} dial position (%)`,
  ]),
  'Capture ID', 'Camera ID', 'GPS device ID', 'Bus record ID',
  'Captured at (UTC)', 'Received by backend (UTC)', 'Exported at (UTC)', 'Detector version',
];

// Call only after the export's existing identity/time/quality validation.
// Each row contains one original capture, never an average or a carried value.
export function cameraCsvTable({ frames, busLabel, includeDetails = false, now }) {
  const columns = includeDetails ? [...CAMERA_CSV_COLUMNS, ...CAMERA_CSV_DETAIL_COLUMNS] : [...CAMERA_CSV_COLUMNS];
  const rows = frames.map(frame => {
    const readings = LIVE_GAUGE_KEYS.map(key => frame.readings.find(reading => reading.gauge_key === key));
    const localTime = philippineCsvTime(frame.captured_at);
    const available = reading => reading.quality === 'detected' && typeof reading.value === 'number';
    const notes = readings.flatMap((reading, index) => available(reading) ? [] : [
      `${LIVE_GAUGE_TITLES[LIVE_GAUGE_KEYS[index]]}: ${reading.quality === 'detected'
        ? 'Angle only; no supported value' : QUALITY_LABELS[reading.quality]}`,
    ]).join('; ');
    const row = [localTime.date, localTime.time, busLabel || frame.bus_id,
      `${frame.device_id === 'GPS-001' ? 'Pi1' : 'Pi2'} (${frame.device_id})`,
      ...readings.map(reading => available(reading) ? reading.value : null),
      readings.filter(available).length];
    if (includeDetails) row.push(notes, ...readings.flatMap(reading => [QUALITY_LABELS[reading.quality], reading.angle_deg, reading.dial_percent]),
      frame.capture_id, frame.camera_id, frame.device_id, frame.bus_id, frame.captured_at,
      frame.received_at ?? null, new Date(now).toISOString(), frame.processor_version ?? null);
    return row;
  });
  const csv = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { csv, columns, rows };
}
