import { recordGpsLatency } from './gpsLatency';

afterEach(() => { sessionStorage.clear(); delete window.centrabusGpsLatency; });

test('latency capture is disabled by default', () => {
  recordGpsLatency('frontend-received', { busId: 'a' });
  expect(window.centrabusGpsLatency).toBeUndefined();
});

test('enabled timing buffer is bounded and includes only allowlisted metadata', () => {
  sessionStorage.setItem('centrabus.gpsLatencyDebug', '1');
  for (let i = 0; i < 501; i += 1) recordGpsLatency('frontend-received', { busId: 'a', capturedAt: i, secret: 'never-copy', latitude: 14 });
  expect(window.centrabusGpsLatency).toHaveLength(500);
  expect(window.centrabusGpsLatency[0].capturedAt).toBe(1);
  expect(JSON.stringify(window.centrabusGpsLatency)).not.toMatch(/never-copy|latitude/);
});
