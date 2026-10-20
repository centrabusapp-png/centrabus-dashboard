// Display-only model. No default physical scales, units or alert thresholds.
export const LIVE_GAUGE_KEYS = ['fuel', 'oilPressure', 'coolant', 'frontAir', 'battery', 'rearAir'];
export const LIVE_GAUGE_TITLES = { fuel: 'Fuel', oilPressure: 'Oil', coolant: 'Coolant',
  frontAir: 'Front air pressure', battery: 'Battery', rearAir: 'Rear air pressure' };

// Same 25/75 dial bands and labels as the existing Python gauge reader.
// These describe the printed dial position, NOT physical safety thresholds.
export function cameraDialStatus(gauge) {
  if (gauge.unverified !== true || gauge.quality !== 'detected'
    || gauge.status !== 'Reading Available' || !Number.isFinite(gauge.numericValue)
    || !Number.isFinite(gauge.dialPositionPercent) || gauge.dialPositionPercent<0 || gauge.dialPositionPercent>100) return null;
  const bands={fuel:['Empty','Half','Full'],coolant:['Cold','Mid-range','Hot'],
    battery:['Low','Mid-range','High'],oilPressure:['Low','Mid-range','High']};
  const labels=bands[gauge.gaugeKey];
  if(!labels)return 'Pressure reading';
  return labels[gauge.dialPositionPercent<25?0:gauge.dialPositionPercent<75?1:2];
}
export const LIVE_GAUGE_PLACEHOLDERS = LIVE_GAUGE_KEYS.map((key) => ({
  id: `unavailable:${key}`, gaugeKey: key, label: LIVE_GAUGE_TITLES[key], status: 'Awaiting Data', source: 'camera',
}));

export function cameraDeviceAssociation(buses, deviceId) {
  // Reuse explicit device identity from the dashboard's existing GPS rows.
  // Never infer an assignment from list order, plate number or proximity.
  const matches = Array.isArray(buses) ? buses.filter((bus) => bus?.gps?.deviceId === deviceId
    && typeof bus.id === 'string' && bus.id.length > 0) : [];
  if (matches.length !== 1) return { busId: null, plate: null,
    message: matches.length ? 'Device-to-bus association is ambiguous. Gauge readings are withheld.'
      : 'Waiting for a verified device-to-bus association.' };
  return { busId: matches[0].id, plate: matches[0].plateNumber || matches[0].id, message: null };
}

export function approvedDialPosition(gauge, calibration) {
  // Validation bounds are NOT automatically a physical dial scale. The camera
  // team must explicitly approve displayScale in the reviewed calibration policy.
  const rule = calibration?.approved === true ? calibration.gauges?.[gauge.gaugeKey] : null;
  const scale = rule?.displayScale;
  if (!['Reading Available', 'Stale'].includes(gauge.status) || !Number.isFinite(gauge.numericValue)
    || gauge.unit !== rule?.unit || scale?.approved !== true || !Number.isFinite(scale.min)
    || !Number.isFinite(scale.max) || scale.max <= scale.min
    || scale.min < rule.min || scale.max > rule.max
    || gauge.numericValue < scale.min || gauge.numericValue > scale.max) return null;
  return { percent: (gauge.numericValue - scale.min) / (scale.max - scale.min) * 100,
    min: scale.min, max: scale.max };
}
