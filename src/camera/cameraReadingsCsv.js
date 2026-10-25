import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel.js';
import { cameraCsvTable } from './cameraCsvFormat.js';

const textId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const numberOrNull = (value, min, max) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
// Pure same-capture export. No source timestamps are replaced by receipt/export
// time, and rejected readings remain empty rather than becoming numeric zero.
export function createCameraReadingsCsv({ frame, deviceId, state, busLabel, includeDetails = false, now }) {
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
  const { csv } = cameraCsvTable({ frames: [frame], busLabel, includeDetails, now });
  return { blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), csv,
    filename: `centrabus-${deviceId}-readings-${frame.captured_at.replace(/[^A-Za-z0-9-]/g, '-')}.csv` };
}
