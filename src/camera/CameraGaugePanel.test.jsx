import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CameraGaugePanel from './CameraGaugePanel';
import { cameraSnapshot, TEST_CALIBRATION as CAL, TEST_TIME as TIME } from './testing/fixtures';
import { createCameraDashboardMetrics } from './cameraMetrics';
const clock = () => TIME;
const renderPanel = (props = {}) => render(<CameraGaugePanel enabled busId="test-bus" calibration={CAL} clock={clock} {...props} />);
test('disabled panel performs no reads', () => {
  const service = { readLatest: jest.fn() }; renderPanel({ enabled: false, service });
  expect(screen.queryByTestId('camera-gauge-panel')).not.toBeInTheDocument(); expect(service.readLatest).not.toHaveBeenCalled();
});
test('calibration missing => Awaiting Data, disabled refresh, no reads', () => {
  const service = { readLatest: jest.fn() }; renderPanel({ service, calibration: null });
  expect(screen.getByText('Awaiting Data')).toBeInTheDocument(); expect(screen.getByRole('button')).toBeDisabled();
  expect(service.readLatest).not.toHaveBeenCalled(); expect(screen.queryByText(/Normal/)).not.toBeInTheDocument();
});
test('loading to numerical results; missing oil is not Oil Level/zero/Normal', async () => {
  let resolve; const service = { readLatest: jest.fn(() => new Promise((r) => { resolve = r; })) };
  renderPanel({ service }); expect(screen.getByText('Loading')).toBeInTheDocument(); await waitFor(() => expect(service.readLatest).toHaveBeenCalled());
  await act(async () => resolve(cameraSnapshot()));
  expect(screen.getByText('42 fixture-unit')).toBeInTheDocument(); expect(screen.getByText('Oil gauge (meaning unconfirmed)')).toBeInTheDocument();
  expect(screen.queryByText(/Oil Level|Normal|0 fixture-unit/)).not.toBeInTheDocument(); expect(screen.getByText(/1000|1s ago/)).toBeInTheDocument();
});
test('stale keeps last known value and original timestamp; not a normal reading', async () => {
  renderPanel({ service: { readLatest: async () => cameraSnapshot({ captured_at: new Date(TIME - 60_000).toISOString() }) } });
  await screen.findByText('42 fixture-unit'); expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);
  expect(screen.getByText(/60s ago/)).toBeInTheDocument(); expect(screen.queryByText('Normal')).not.toBeInTheDocument();
});
test('invalid DTO renders Invalid and no values', async () => {
  renderPanel({ service: { readLatest: async () => cameraSnapshot({ numeric_value: Infinity }) } });
  await screen.findByText('Invalid'); expect(screen.queryByText('42 fixture-unit')).not.toBeInTheDocument();
});
test('unavailable/offline worker transport shows Unavailable; manual refresh retries once', async () => {
  const service = { readLatest: jest.fn().mockRejectedValueOnce(new Error('private-test-error')).mockResolvedValueOnce(cameraSnapshot()) };
  renderPanel({ service }); await screen.findByText('Unavailable'); expect(screen.queryByText('private-test-error')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh gauge readings' })); await screen.findByText('42 fixture-unit');
  expect(service.readLatest).toHaveBeenCalledTimes(2);
});
test('multiple camera ambiguity is explicit', async () => {
  const snapshot = cameraSnapshot(); snapshot.cameras.push({ camera_id: 'TEST-CAM-2', bus_id: 'test-bus', enabled: true });
  renderPanel({ service: { readLatest: async () => snapshot } }); await screen.findByText(/Multiple cameras are assigned/);
  expect(screen.queryByText('42 fixture-unit')).not.toBeInTheDocument();
});
test('switch bus clears previous values immediately; unmount aborts read', async () => {
  let secondSignal; const service = { readLatest: jest.fn((busId, { signal }) => {
    if (busId === 'test-bus') return Promise.resolve(cameraSnapshot()); secondSignal = signal; return new Promise(() => {});
  }) };
  const { rerender, unmount } = renderPanel({ service }); await screen.findByText('42 fixture-unit');
  rerender(<CameraGaugePanel enabled busId="other-bus" calibration={CAL} clock={clock} service={service} />);
  expect(screen.queryByText('42 fixture-unit')).not.toBeInTheDocument(); await waitFor(() => expect(secondSignal).toBeDefined());
  unmount(); expect(secondSignal.aborted).toBe(true);
});
test('age advances without polling/additional queries', async () => {
  jest.useFakeTimers(); let time = TIME; const now = () => time; const service = { readLatest: jest.fn(async () => cameraSnapshot()) };
  const { unmount } = renderPanel({ service, clock: now }); await act(async () => {});
  time += 31_000; act(() => jest.advanceTimersByTime(1000)); expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);
  expect(service.readLatest).toHaveBeenCalledTimes(1); unmount(); expect(jest.getTimerCount()).toBe(0); jest.useRealTimers();
});
test('hung read times out and aborts cleanly', async () => {
  jest.useFakeTimers(); let signal; const service = { readLatest: jest.fn((busId, options) => { signal = options.signal; return new Promise(() => {}); }) };
  const { unmount } = renderPanel({ service, timeoutMs: 10 }); await act(async () => {});
  await act(async () => jest.advanceTimersByTime(10)); expect(screen.getByText('Unavailable')).toBeInTheDocument(); expect(signal.aborted).toBe(true);
  unmount(); jest.useRealTimers();
});

test('camera latency uses original capture and metrics add no reads/identifiers', async () => {
  const metrics = createCameraDashboardMetrics(); const service = { readLatest: jest.fn(async () => cameraSnapshot()) };
  renderPanel({ service, metrics }); await screen.findByText('42 fixture-unit');
  expect(metrics.snapshot().metrics.dashboard_capture_latency_ms.mean).toBe(1000);
  expect(metrics.snapshot().metrics.missing_readings.total).toBeGreaterThan(0);
  expect(service.readLatest).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(metrics.snapshot())).not.toMatch(/test-bus|TEST-CAM|captured_at|fixture-unit/);
});

test('stale transition is counted once, age ticks never resample display latency', async () => {
  jest.useFakeTimers(); let time = TIME; const metrics = createCameraDashboardMetrics();
  const service = { readLatest: jest.fn(async () => cameraSnapshot()) };
  const { unmount } = renderPanel({ service, metrics, clock: () => time }); await act(async () => {});
  const initial = metrics.snapshot().metrics.dashboard_capture_latency_ms.samples;
  time += 31_000; act(() => jest.advanceTimersByTime(1000));
  expect(metrics.snapshot().metrics.stale_readings.total).toBe(1);
  act(() => jest.advanceTimersByTime(3000));
  expect(metrics.snapshot().metrics.stale_readings.total).toBe(1);
  expect(metrics.snapshot().metrics.dashboard_capture_latency_ms.samples).toBe(initial);
  expect(service.readLatest).toHaveBeenCalledTimes(1); unmount(); jest.useRealTimers();
});

test('invalid and unavailable snapshots do not fabricate performance/values', async () => {
  const metrics = createCameraDashboardMetrics();
  const service = { readLatest: jest.fn().mockRejectedValueOnce(new Error('private-secret'))
    .mockResolvedValueOnce(cameraSnapshot({ bus_id: 'wrong-bus' })) };
  renderPanel({ service, metrics }); await screen.findByText('Unavailable');
  expect(metrics.snapshot().metrics.read_failures.total).toBe(1);
  fireEvent.click(screen.getByRole('button')); await screen.findByText('Invalid');
  expect(metrics.snapshot().metrics.invalid_states.total).toBe(1);
  expect(metrics.snapshot().metrics.dashboard_capture_latency_ms).toBeUndefined();
  expect(screen.queryByText('42 fixture-unit')).not.toBeInTheDocument();
});

test('disabled panel records nothing; failing metric sink cannot break a valid display', async () => {
  const observer = jest.fn(() => { throw new Error('private-observer-error'); });
  const { rerender } = renderPanel({ enabled: false, metrics: { observe: observer } });
  expect(observer).not.toHaveBeenCalled();
  rerender(<CameraGaugePanel enabled busId="test-bus" calibration={CAL} clock={clock}
    service={{ readLatest: async () => cameraSnapshot() }} metrics={{ observe: observer }} />);
  await screen.findByText('42 fixture-unit'); expect(observer).toHaveBeenCalled();
  expect(screen.queryByText('private-observer-error')).not.toBeInTheDocument();
});
