import { LIVE_GAUGE_KEYS, LIVE_GAUGE_TITLES } from './liveCameraGaugeModel';

const textId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const numberOrNull = (value, min, max) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
// Quote every field and neutralize spreadsheet formulas, including identities
// returned by the service. Never generate HTML, formulas or external requests.
function cell(value) {
  const text = value == null ? '' : String(value);
  return `"${(typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}

// Pure same-capture export. No source timestamps are replaced by receipt/export
// time, and rejected readings remain empty rather than becoming numeric zero.
export function createCameraReadingsCsv({ frame, deviceId, state, now }) {
  const captured = Date.parse(frame?.captured_at);
  if (state !== 'live' || !['GPS-001', 'GPS-002'].includes(deviceId) || frame?.device_id !== deviceId
    || !Number.isFinite(now) || !Number.isFinite(captured) || new Date(captured).toISOString() !== frame.captured_at
    || now - captured > 15000 || captured - now > 2000
    || !textId(frame.camera_id) || !textId(frame.bus_id) || !textId(frame.capture_id)
    || !Array.isArray(frame.readings) || frame.readings.length !== 6) throw new Error('csv-source-unavailable');
  const seen = new Set();
  for (const reading of frame.readings) {
    const pressure = ['frontAir', 'rearAir'].includes(reading.gauge_key);
    if (!LIVE_GAUGE_KEYS.includes(reading.gauge_key) || seen.has(reading.gauge_key)
      || !['detected', 'uncertain', 'undetected'].includes(reading.quality)
      || reading.unit !== (pressure ? 'kg/cm2' : '%') || !numberOrNull(reading.value, 0, pressure ? 1000 : 100)
      || !numberOrNull(reading.angle_deg, -360, 360) || !numberOrNull(reading.dial_percent, 0, 100)
      || reading.quality === 'detected' && reading.angle_deg === null
      || reading.quality !== 'detected' && [reading.value, reading.angle_deg, reading.dial_percent].some((value) => value !== null))
      throw new Error('csv-source-unavailable');
    seen.add(reading.gauge_key);
  }
  const exportedAt = new Date(now).toISOString();
  const columns = ['device_id', 'camera_id', 'bus_id', 'capture_id', 'captured_at_utc', 'exported_at_utc',
    'gauge', 'quality', 'value', 'unit', 'angle_deg', 'dial_position_percent', 'physical_accuracy'];
  const rows = LIVE_GAUGE_KEYS.map((key) => {
    const reading = frame.readings.find((row) => row.gauge_key === key);
    return [deviceId, frame.camera_id, frame.bus_id, frame.capture_id, frame.captured_at, exportedAt,
      LIVE_GAUGE_TITLES[key], reading.quality, reading.value, reading.unit, reading.angle_deg, reading.dial_percent, 'unverified'];
  });
  const csv = '\uFEFF' + [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  return { blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), csv,
    filename: `centrabus-${deviceId}-readings-${frame.captured_at.replace(/[^A-Za-z0-9-]/g, '-')}.csv` };
}
