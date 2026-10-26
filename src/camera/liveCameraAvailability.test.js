import { liveCameraAvailable } from './liveCameraAvailability';

test('development keeps the camera diagnostics page available without a configured feed', () => {
  expect(liveCameraAvailable('development', false)).toBe(true);
  expect(liveCameraAvailable('test', false)).toBe(true);
});

test('production exposes the camera page only when approved frame service is enabled', () => {
  expect(liveCameraAvailable('production', false)).toBe(false);
  expect(liveCameraAvailable('production', true)).toBe(true);
  expect(liveCameraAvailable('production', 'true')).toBe(false);
});
