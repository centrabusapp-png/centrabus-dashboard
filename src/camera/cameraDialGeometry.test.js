import { BUS_DIAL, BUS_DIAL_PATH, detectedNeedleAngle, dialPoint, dialScaleAngle } from './cameraDialGeometry';

test('display artwork is a short upper bus arc, not a semicircle or a calibration', () => {
  expect(BUS_DIAL.start - BUS_DIAL.end).toBe(110);
  expect(BUS_DIAL_PATH).toContain('A 88 88 0 0 1');
  expect(dialScaleAngle(0)).toBe(145);
  expect(dialScaleAngle(50)).toBe(90);
  expect(dialScaleAngle(100)).toBe(35);
  const left = dialPoint(145, 88), right = dialPoint(35, 88);
  expect(left.y).toBeCloseTo(right.y);
  expect(left.y).toBeLessThan(BUS_DIAL.cy);
  expect(dialPoint(90, 88)).toEqual({ x:100, y:20 });
});

test('detected angle comes only from a fresh source observation, never from a dial percentage', () => {
  const gauge = { quality:'detected', status:'Reading Available', angleDegrees:115.02, dialPositionPercent:31.911 };
  expect(detectedNeedleAngle(gauge)).toBe(115.02);
  expect(detectedNeedleAngle({ ...gauge, dialPositionPercent:99 })).toBe(115.02);
  for (const changed of [{quality:'uncertain'}, {quality:'undetected'}, {status:'Stale'}, {angleDegrees:null}, {angleDegrees:NaN}])
    expect(detectedNeedleAngle({ ...gauge, ...changed })).toBeNull();
});
