export function rawGpsSpeed(gps = {}) {
  const value = gps?.rawSpeedKmh;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 250 ? number : null;
}

export function rawGpsMotion(gps = {}) {
  gps = gps || {};
  const raw = rawGpsSpeed(gps);
  const measurement = (value) => value === null || value === undefined || value === ''
    ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const accuracy = measurement(gps.horizontalAccuracyM);
  if (raw === null || ['WEAK', 'UNKNOWN'].includes(gps.gpsQuality)
    || (accuracy !== null && accuracy > 15)) return 'UNKNOWN';
  const d2 = measurement(gps.movement2sM);
  const d4 = measurement(gps.movement4sM);
  const d6 = measurement(gps.movement6sM);
  if (raw >= 3 && ((d2 !== null && d2 >= 2) || (d4 !== null && d4 >= 3)
    || (d6 !== null && d6 >= 4))) return 'MOVING';
  if (raw <= 2 && d6 !== null && d6 <= 3) return 'STOPPED';
  return 'UNKNOWN';
}
