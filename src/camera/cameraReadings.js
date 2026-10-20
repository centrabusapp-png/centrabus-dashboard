export const CAMERA_GAUGE_KEYS = ['fuel', 'coolant', 'frontAir', 'rearAir', 'battery', 'oilPressure'];
export const CAMERA_GAUGE_LABELS = { fuel: 'Fuel gauge', coolant: 'Coolant gauge', frontAir: 'Front air pressure',
  rearAir: 'Rear air pressure', battery: 'Battery gauge', oilPressure: 'Oil gauge (meaning unconfirmed)' };
export const CAMERA_READING_COLUMNS = ['bus_id', 'camera_id', 'gauge_key', 'numeric_value', 'unit', 'confidence',
  'captured_at', 'received_at', 'processed_at', 'processor_version', 'algorithm_version', 'model_artifact_version',
  'calibration_version', 'result_status'];
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function cameraReadingsFeatureEnabled(value = process.env.VITE_CAMERA_READINGS_ENABLED) { return value === 'true'; }
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : NaN;
}
function numeric(value) {
  // PostgREST NUMERIC may arrive as a number or decimal string, never blank/hex.
  if (typeof value === 'string' && !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) return NaN;
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < 1e12
    && Math.abs(number * 1e6 - Math.round(number * 1e6)) < 0.0001 ? number : NaN;
}
export function validCameraCalibration(policy) {
  return policy?.approved === true && ['processor_version', 'algorithm_version', 'calibration_version']
    .every((key) => typeof policy[key] === 'string' && VERSION.test(policy[key]))
    && (policy.model_artifact_version == null || VERSION.test(policy.model_artifact_version))
    && policy.gauges && Object.keys(policy.gauges).length > 0 && Object.keys(policy.gauges).length <= 6
    && Object.entries(policy.gauges).every(([key, rule]) => CAMERA_GAUGE_KEYS.includes(key)
      && typeof rule.unit === 'string' && rule.unit.trim().length > 0 && rule.unit.length <= 32
      && Number.isFinite(rule.min) && Number.isFinite(rule.max) && rule.min <= rule.max
      && Number.isFinite(rule.minConfidence) && rule.minConfidence >= 0 && rule.minConfidence <= 1)
    && Number.isFinite(policy.staleAfterMs) && policy.staleAfterMs > 0
    && Number.isFinite(policy.maxFutureSkewMs) && policy.maxFutureSkewMs >= 0;
}
export function cameraPanelState(status, message, gauges = []) { return { status, message, gauges }; }
export function deriveCameraPanel(snapshot, busId, policy, nowMs = Date.now(), expectedCameraId = null) {
  if (!validCameraCalibration(policy)) return cameraPanelState('Awaiting Data', 'Approved calibration and gauge units are required. Alerts remain inactive.');
  if (!snapshot || !Array.isArray(snapshot.cameras) || !Array.isArray(snapshot.readings)
    || snapshot.cameras.length > 3 || snapshot.readings.length > 6) return cameraPanelState('Invalid', 'Camera response is invalid.');
  if (snapshot.cameras.some((camera) => !camera || camera.bus_id !== busId || typeof camera.camera_id !== 'string'
    || !VERSION.test(camera.camera_id) || typeof camera.enabled !== 'boolean')) return cameraPanelState('Invalid', 'Camera assignment is invalid.');
  const cameras = snapshot.cameras.filter((camera) => camera.enabled);
  if (cameras.length > 1) return cameraPanelState('Invalid', 'Multiple cameras are assigned. A primary source must be approved.');
  if (!cameras.length) return cameraPanelState('Awaiting Data', 'No enabled camera is assigned to this bus.');
  const cameraId = cameras[0].camera_id;
  if (expectedCameraId != null && cameraId !== expectedCameraId) {
    return cameraPanelState('Invalid', 'The preview and gauge readings identify different cameras. Readings are withheld.');
  }
  if (new Set(snapshot.readings.map((row) => row?.captured_at)).size > 1) {
    return cameraPanelState('Invalid', 'Readings identify different capture epochs. Mixed observations are withheld.');
  }
  const seen = new Set(); const values = new Map();
  for (const row of snapshot.readings) {
    if (!row || Object.keys(row).some((key) => !CAMERA_READING_COLUMNS.includes(key))) return cameraPanelState('Invalid', 'Camera response contains unsupported fields.');
    const rule = policy.gauges[row.gauge_key];
    const capturedMs = utc(row.captured_at); const receivedMs = utc(row.received_at); const processedMs = utc(row.processed_at);
    const value = numeric(row.numeric_value); const confidence = numeric(row.confidence);
    if (row.bus_id !== busId || row.camera_id !== cameraId || !CAMERA_GAUGE_KEYS.includes(row.gauge_key) || !rule || seen.has(row.gauge_key)
      || !Number.isFinite(capturedMs) || !Number.isFinite(receivedMs) || !Number.isFinite(processedMs)
      || capturedMs > nowMs + policy.maxFutureSkewMs || receivedMs > nowMs + policy.maxFutureSkewMs
      || processedMs > nowMs + policy.maxFutureSkewMs || processedMs < receivedMs
      || capturedMs > receivedMs + policy.maxFutureSkewMs
      || !Number.isFinite(value) || value < rule.min || value > rule.max || row.unit !== rule.unit
      || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || !['complete', 'partial'].includes(row.result_status)
      || ['processor_version', 'algorithm_version', 'calibration_version'].some((key) => row[key] !== policy[key])
      || (row.model_artifact_version ?? null) !== (policy.model_artifact_version ?? null)) return cameraPanelState('Invalid', 'Numerical results failed validation.');
    seen.add(row.gauge_key);
    if (confidence < rule.minConfidence) continue;
    const ageMs = Math.max(0, nowMs - capturedMs);
    values.set(row.gauge_key, { source: 'camera', id: `${cameraId}:${row.gauge_key}`, cameraId, gaugeKey: row.gauge_key,
      label: CAMERA_GAUGE_LABELS[row.gauge_key], numericValue: value, unit: row.unit, confidence,
      capturedAt: row.captured_at, ageMs, status: ageMs > policy.staleAfterMs ? 'Stale' : 'Reading Available' });
  }
  const gauges = CAMERA_GAUGE_KEYS.filter((key) => policy.gauges[key]).map((key) => values.get(key) || {
    source: 'camera', id: `${cameraId}:${key}`, gaugeKey: key, label: CAMERA_GAUGE_LABELS[key], status: 'Awaiting Data',
  });
  if (!values.size) return cameraPanelState('Awaiting Data', 'No sufficiently confident numerical readings are available.', gauges);
  const stale = [...values.values()].some((gauge) => gauge.status === 'Stale');
  return cameraPanelState(stale ? 'Stale' : 'Reading Available',
    stale ? 'Last-known readings; ages use the original capture time. Alerts remain inactive.'
      : 'Validated numbers only. Missing gauges remain unknown. Calibration-dependent alerts are inactive.', gauges);
}
