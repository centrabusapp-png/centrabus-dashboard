import { createCameraDashboardMetrics, observeCameraDashboard } from './cameraMetrics';

test('bounded aggregate camera metrics accept only safe finite values/names', () => {
  const metrics = createCameraDashboardMetrics();
  for (let i = 0; i < 10000; i++) expect(metrics.observe('dashboard_capture_latency_ms', i)).toBe(true);
  for (const value of [NaN, Infinity, -1, 'secret', {}, undefined]) expect(metrics.observe('read_failures', value)).toBe(false);
  expect(metrics.observe('bus-secret', 1)).toBe(false);
  expect(metrics.observe('read_failures', 0.1)).toBe(false);
  const snapshot = metrics.snapshot();
  expect(Object.keys(snapshot.metrics)).toHaveLength(1);
  expect(snapshot.metrics.dashboard_capture_latency_ms.samples).toBe(10000);
  snapshot.metrics.dashboard_capture_latency_ms.total = -1;
  expect(metrics.snapshot().metrics.dashboard_capture_latency_ms.total).toBeGreaterThan(0);
});

test('broken metrics sink is isolated from the dashboard', () => {
  expect(() => observeCameraDashboard({ observe() { throw new Error('private'); } }, 'read_failures', 1)).not.toThrow();
});
