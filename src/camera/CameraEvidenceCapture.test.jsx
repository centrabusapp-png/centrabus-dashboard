import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LiveCameraView from './LiveCameraView';
import { mockEvidenceImages } from './testing/evidenceFixtures';
import { cameraSnapshot, TEST_CALIBRATION, TEST_TIME } from './testing/fixtures';
import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel';

let service, session, track, encode, createUrl, revokeUrl, click;
const button = () => screen.getByRole('button', { name: 'Capture Pi1 camera and gauges' });
beforeEach(() => {
  mockEvidenceImages();
  track = new EventTarget(); Object.assign(track, { kind: 'video', readyState: 'live', stop: jest.fn() });
  const stream = { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] };
  session = { deviceId: 'GPS-001', cameraId: 'fixture-camera', stream, close: jest.fn() };
  service = { isConfigured: () => true, open: jest.fn(async () => session) };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: jest.fn(), drawImage: jest.fn(), fillText: jest.fn() });
  encode = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(new Blob(['fixture'], { type: 'image/png' })));
  createUrl = URL.createObjectURL; revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:camera-evidence'); URL.revokeObjectURL = jest.fn();
  click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; });

async function playing() {
  fireEvent.click(screen.getByRole('switch', { name: 'Pi1 camera preview' }));
  await screen.findByText('Waiting for video');
  const video = screen.getByLabelText('Pi1 live camera video');
  for (const [key, value] of Object.entries({ readyState: 2, videoWidth: 640, videoHeight: 360, paused: false, ended: false })) {
    Object.defineProperty(video, key, { value, configurable: true });
  }
  video.currentTime = 1; fireEvent.timeUpdate(video);
  return video;
}

test('one click requests one local PNG, with no new stream or gauge request', async () => {
  const gaugeService = { readLatest: jest.fn() };
  render(<LiveCameraView authorized service={service} gaugeService={gaugeService} />);
  expect(button()).toBeDisabled(); await playing(); expect(button()).toBeEnabled();
  fireEvent.click(button());
  await screen.findByText(/PNG download requested/);
  expect(encode).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
  expect(service.open).toHaveBeenCalledTimes(1); expect(gaugeService.readLatest).not.toHaveBeenCalled();
  expect(button()).toHaveTextContent(/^Capture$/);
  expect(button()).toHaveAttribute('title', 'Download the camera preview and all six gauges together as PNG.');
  expect(screen.queryByText(/One click downloads|Preview on\/off affects|Streaming setup is required/)).not.toBeInTheDocument();
});

test('comparison contains the selected camera and all six displayed numerical readings with original times', async () => {
  const calibration = { ...TEST_CALIBRATION, gauges: Object.fromEntries(LIVE_GAUGE_KEYS.map((key) => [key,
    { unit: 'fixture-unit', min: 0, max: 100, minConfidence: .8, displayScale: { approved: true, min: 0, max: 100 } }])) };
  const base = cameraSnapshot(); base.cameras[0].camera_id = session.cameraId;
  base.readings = LIVE_GAUGE_KEYS.map((key, index) => ({ ...base.readings[0], camera_id: session.cameraId,
    gauge_key: key, numeric_value: index + 42 }));
  const readings = { readLatest: jest.fn(async () => base) };
  render(<LiveCameraView authorized service={service} gaugesEnabled calibration={calibration}
    gaugeService={readings} clock={() => TEST_TIME} buses={[{ id: 'test-bus', plateNumber: 'TEST BUS', gps: { deviceId: 'GPS-001' } }]} />);
  await screen.findByText('42'); await playing(); fireEvent.click(button());
  await screen.findByText(/PNG download requested/);
  const context = HTMLCanvasElement.prototype.getContext.mock.results[0].value;
  const text = context.fillText.mock.calls.map(([line]) => line);
  for (let value = 42; value < 48; value++) expect(text).toContain(String(value));
  expect(text).toContain(new Date(TEST_TIME - 1000).toISOString());
  expect(context.drawImage).toHaveBeenCalledTimes(7);
  expect(readings.readLatest).toHaveBeenCalledTimes(1); expect(service.open).toHaveBeenCalledTimes(1);
});

test('no feed, no decoded frame, paused and buffering frames cannot be captured', async () => {
  const view = render(<LiveCameraView authorized />); expect(button()).toBeDisabled();
  view.rerender(<LiveCameraView authorized service={service} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Pi1 camera preview' }));
  await screen.findByText('Waiting for video'); expect(button()).toBeDisabled();
  const video = screen.getByLabelText('Pi1 live camera video');
  Object.defineProperty(video, 'paused', { value: false, configurable: true });
  video.currentTime = 1; fireEvent.timeUpdate(video); expect(button()).toBeDisabled();
  Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
  video.currentTime = 2; fireEvent.timeUpdate(video); expect(button()).toBeEnabled();
  fireEvent.pause(video); expect(button()).toBeDisabled();
  video.currentTime = 3; fireEvent.timeUpdate(video); fireEvent.waiting(video); expect(button()).toBeDisabled();
  expect(encode).not.toHaveBeenCalled();
});

test('rapid duplicate clicks encode only once and show an actionable sanitized failure', async () => {
  let complete; encode.mockImplementation((callback) => { complete = callback; });
  render(<LiveCameraView authorized service={service} />); await playing();
  fireEvent.click(button()); fireEvent.click(button());
  await waitFor(() => expect(encode).toHaveBeenCalledTimes(1)); expect(button()).toBeDisabled();
  await act(async () => complete(null));
  expect(screen.getByText(/Capture unavailable/)).toBeInTheDocument(); expect(button()).toBeEnabled();
  expect(click).not.toHaveBeenCalled();
});

test.each(['switch', 'stop', 'auth-loss', 'unmount'])('pending encoding cannot download after %s', async (action) => {
  let complete; encode.mockImplementation((callback) => { complete = callback; });
  const view = render(<LiveCameraView authorized service={service} />); await playing();
  fireEvent.click(button());
  await waitFor(() => expect(encode).toHaveBeenCalledTimes(1));
  if (action === 'switch') fireEvent.click(screen.getByRole('tab', { name: /Pi2/ }));
  else if (action === 'stop') fireEvent.click(screen.getByRole('switch', { name: 'Pi1 camera preview' }));
  else if (action === 'auth-loss') view.rerender(<LiveCameraView service={service} />);
  else view.unmount();
  await act(async () => complete(new Blob(['fixture'], { type: 'image/png' })));
  expect(click).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('freshness and live-track checks run again at click time, not only render time', async () => {
  render(<LiveCameraView authorized service={service} />); await playing();
  expect(button()).toBeEnabled(); track.readyState = 'ended';
  fireEvent.click(button());
  await waitFor(() => expect(screen.getByText(/Capture unavailable/)).toBeInTheDocument());
  expect(encode).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});

test('capture is disabled when playback activity is older than three seconds', async () => {
  jest.useFakeTimers();
  try {
    render(<LiveCameraView authorized service={service} />); await playing();
    act(() => jest.advanceTimersByTime(4000)); expect(button()).toBeDisabled();
  } finally { jest.useRealTimers(); }
});
