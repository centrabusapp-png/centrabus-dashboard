// Presentation only: reuse the dashboard's existing live-position subscription.
// A bus association is never inferred from array order, plate, or proximity.
export function setupCaptureTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : NaN;
}

export function deviceGpsSummary(deviceId, gpsByBusId = {}, now = Date.now()) {
  const matches = Object.entries(gpsByBusId || {}).filter(([, gps]) => gps?.deviceId === deviceId);
  if (matches.length !== 1) return {
    label: matches.length ? 'Association conflict' : 'No associated GPS data',
    detail: matches.length ? 'Multiple bus rows identify this device. Verify the device-to-bus mapping before setup.'
      : 'No live-position row identifies this device. Bus order is not used to guess its identity.',
    busId: null, capturedAt: null, ageSeconds: null, recent: false,
  };
  const [busId, gps] = matches[0];
  const timestamp = setupCaptureTime(gps.gpsUpdatedAt);
  const age = (now - timestamp) / 1000;
  const coordinatesValid = Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)
    && Math.abs(gps.latitude) <= 90 && Math.abs(gps.longitude) <= 180;
  const timeValid = Number.isFinite(age) && age >= -2;
  const unavailable = gps.sourceUnavailable === true || gps.online === false;
  const weak = ['WEAK', 'INVALID', 'NO FIX'].includes(String(gps.gpsQuality || '').toUpperCase());
  const recent = timeValid && age <= 10 && coordinatesValid && !unavailable && !weak;
  const label = !timeValid ? 'Capture time unverified' : !coordinatesValid ? 'Position unavailable'
    : unavailable ? 'Last-known GPS' : weak ? 'GPS quality warning' : recent ? 'Recent capture' : 'Stale capture';
  return { busId, label, recent, capturedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    ageSeconds: timeValid ? Math.max(0, age) : null,
    detail: 'Stored GPS observation, not a direct receiver test. Freshness uses original capture time, never heartbeat time.',
    quality: typeof gps.gpsQuality === 'string' ? gps.gpsQuality : null,
    satellites: Number.isInteger(gps.satellitesUsed) && gps.satellitesUsed >= 0 ? gps.satellitesUsed : null,
    accuracy: Number.isFinite(gps.horizontalAccuracyM) && gps.horizontalAccuracyM >= 0 ? gps.horizontalAccuracyM : null,
  };
}

export function setupAgeLabel(seconds) {
  if (!Number.isFinite(seconds)) return 'Unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
