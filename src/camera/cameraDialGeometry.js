// Display artwork only, based on the bus panel's short upper arc. These are NOT
// calibration endpoints or a new angle-to-value conversion for the detector.
export const BUS_DIAL = Object.freeze({ cx: 100, cy: 108, radius: 88, start: 145, end: 35 });

export function dialPoint(angle, radius) {
  const radians = angle * Math.PI / 180;
  return { x: BUS_DIAL.cx + Math.cos(radians) * radius, y: BUS_DIAL.cy - Math.sin(radians) * radius };
}

export function dialScaleAngle(percent) {
  return BUS_DIAL.start + (BUS_DIAL.end - BUS_DIAL.start) * percent / 100;
}

const start = dialPoint(BUS_DIAL.start, BUS_DIAL.radius);
const end = dialPoint(BUS_DIAL.end, BUS_DIAL.radius);
export const BUS_DIAL_PATH = `M ${start.x} ${start.y} A 88 88 0 0 1 ${end.x} ${end.y}`;

export function detectedNeedleAngle(gauge) {
  // Never derive an angle from a percentage, screenshot, last-known value or
  // an uncertain observation. Preserve the source camera angle verbatim.
  return gauge.quality === 'detected' && gauge.status === 'Reading Available'
    && Number.isFinite(gauge.angleDegrees) ? gauge.angleDegrees : null;
}
