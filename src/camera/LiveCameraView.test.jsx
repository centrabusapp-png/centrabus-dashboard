import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LiveCameraView, { LiveCameraTile } from './LiveCameraView';
import { LIVE_CAMERA_DEVICES } from './liveCameraService';

function fixture(deviceId = 'GPS-001') {
  const track = new EventTarget();
  Object.assign(track, { kind: 'video', readyState: 'live', stop: jest.fn() });
  return { deviceId, cameraId: deviceId === 'GPS-001' ? 'synthetic-camera-1' : 'synthetic-camera-2', close: jest.fn(),
    stream: { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] }, track };
}
function adapter(sessions) {
  return { isConfigured: () => true, open: jest.fn(async (deviceId) => sessions[deviceId]) };
}
const tile = (name) => screen.getByRole('region', { name: `${name} camera` });
const select = (name) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));
async function opened(name) { return within(tile(name)).findByText('Waiting for video'); }
function progress(name, time) {
  const element = screen.getByLabelText(`${name} live camera video`);
  Object.defineProperty(element, 'paused', { value: false, configurable: true });
  element.currentTime = time; fireEvent.timeUpdate(element);
  return element;
}

test('selected preview is left of six honest gauge placeholders with Pi1/Pi2 selection', () => {
  const view = render(<LiveCameraView authorized />);
  expect(screen.getByText('Feed not configured')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByText('No video feed')).toBeInTheDocument();
  expect(screen.getAllByText('Awaiting data')).toHaveLength(6);
  const workspace = view.container.querySelector('.live-camera-workspace');
  expect(workspace.children[0]).toBe(tile('Pi1'));
  expect(workspace.children[1]).toBe(screen.getByRole('region', { name: 'Pi1 vehicle condition' }));
  expect(view.container.querySelectorAll('.aspect-video')).toHaveLength(1);
  for (const video of view.container.querySelectorAll('video')) {
    expect(video.getAttribute('src')).toBeNull(); expect(video.srcObject).toBeUndefined();
    expect(video).toHaveAttribute('preload', 'none'); expect(video).toHaveAttribute('playsinline');
  }
  select('Pi2');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getAllByText('Awaiting data')).toHaveLength(6);
});

test('unauthorized view exposes no video or source operation', () => {
  const service = adapter({}); const view = render(<LiveCameraView service={service} />);
  expect(screen.getByText(/Active administrator access/)).toBeInTheDocument();
  expect(view.container.querySelector('video')).toBeNull(); expect(service.open).not.toHaveBeenCalled();
});

test('mounting auto-opens; switching devices stops old preview and preserves device isolation', async () => {
  const first = fixture(), second = fixture('GPS-002');
  const service = adapter({ 'GPS-001': first, 'GPS-002': second });
  render(<LiveCameraView authorized service={service} />);
  await opened('Pi1');
  expect(service.open).toHaveBeenCalledWith('GPS-001', expect.objectContaining({ signal: expect.anything() }));
  expect(screen.getByLabelText('Pi1 live camera video').srcObject).toBe(first.stream);
  expect(screen.queryByLabelText('Pi2 live camera video')).not.toBeInTheDocument();
  progress('Pi1', 1);
  expect(within(tile('Pi1')).getByText('Receiving video')).toBeInTheDocument();
  select('Pi2');
  expect(first.close).toHaveBeenCalledTimes(1); expect(first.track.stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Pi1 live camera video')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Pi2 live camera video').srcObject).toBeUndefined();
  await opened('Pi2');
  expect(screen.getByLabelText('Pi2 live camera video').srcObject).toBe(second.stream);
  expect(within(tile('Pi2')).getByText(second.cameraId)).toBeInTheDocument();
  expect(screen.queryByText('Receiving video')).not.toBeInTheDocument();
  progress('Pi2', 1);
  expect(within(tile('Pi2')).getByText('Receiving video')).toBeInTheDocument();
});

test('unmount releases only the owned Pi1 stream and does not open Pi2', async () => {
  const first = fixture(), second = fixture('GPS-002'); const service = adapter({ 'GPS-001': first, 'GPS-002': second });
  const view = render(<LiveCameraView authorized service={service} />);
  await opened('Pi1');
  const video = screen.getByLabelText('Pi1 live camera video');
  view.unmount();
  expect(first.close).toHaveBeenCalledTimes(1); expect(first.track.stop).toHaveBeenCalledTimes(1);
  expect(second.close).not.toHaveBeenCalled(); expect(second.track.stop).not.toHaveBeenCalled();
  expect(video.srcObject).toBeNull();
  expect(service.open).toHaveBeenCalledTimes(1);
});

test('camera identity mismatch fails closed, disposes stream and does not affect other panel', async () => {
  const wrong = fixture('GPS-002'); const service = adapter({ 'GPS-001': wrong });
  render(<LiveCameraView authorized service={service} />);
  await within(tile('Pi1')).findByText('Connection failed');
  expect(wrong.close).toHaveBeenCalledTimes(1); expect(wrong.track.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Pi1 live camera video').srcObject).not.toBe(wrong.stream);
  select('Pi2'); await within(tile('Pi2')).findByText('Connection failed');
  expect(service.open).toHaveBeenLastCalledWith('GPS-002', expect.objectContaining({ signal: expect.anything() }));
});

test('connection error is sanitized with no retry loop', async () => {
  const service = { isConfigured: () => true, open: jest.fn(async () => { throw new Error('secret-fixture-do-not-display'); }) };
  const view = render(<LiveCameraView authorized service={service} />);
  await within(tile('Pi1')).findByText('Connection failed');
  expect(view.container.textContent).not.toContain('secret-fixture-do-not-display');
  expect(service.open).toHaveBeenCalledTimes(1);
});

test('unmount during connection aborts and disposes a late success', async () => {
  let resolve; const item = fixture();
  const service = { isConfigured: () => true, open: jest.fn(() => new Promise((done) => { resolve = done; })) };
  const view = render(<LiveCameraView authorized service={service} />);
  await waitFor(() => expect(service.open).toHaveBeenCalledTimes(1));
  view.unmount();
  expect(service.open.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => resolve(item));
  expect(item.track.stop).toHaveBeenCalledTimes(1); expect(item.close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region', { name: 'Pi1 camera' })).not.toBeInTheDocument();
});

test('hung connect has a bounded timeout and late media is released', async () => {
  jest.useFakeTimers();
  try {
    let resolve; const item = fixture();
    const service = { isConfigured: () => true, open: jest.fn(() => new Promise((done) => { resolve = done; })) };
    render(<LiveCameraTile device={LIVE_CAMERA_DEVICES[0]} service={service} timeoutMs={100} />);
    await act(async () => {});
    await act(async () => jest.advanceTimersByTime(101));
    expect(within(tile('Pi1')).getByText('Connection failed')).toBeInTheDocument();
    expect(service.open.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(item)); expect(item.close).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('frame activity expires instead of leaving a frozen video labeled as receiving', async () => {
  jest.useFakeTimers();
  try {
    const service = adapter({ 'GPS-001': fixture() });
    render(<LiveCameraView authorized service={service} />);
    await act(async () => {});
    progress('Pi1', 1); expect(within(tile('Pi1')).getByText('Receiving video')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(11000));
    expect(within(tile('Pi1')).getByText('Video delayed')).toBeInTheDocument();
    progress('Pi1', 2); expect(within(tile('Pi1')).getByText('Receiving video')).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

test('waiting with no frames also becomes delayed', async () => {
  jest.useFakeTimers();
  try {
    render(<LiveCameraView authorized service={adapter({ 'GPS-001': fixture() })} />);
    await act(async () => {});
    act(() => jest.advanceTimersByTime(11000));
    expect(within(tile('Pi1')).getByText('Video delayed')).toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

test('pause, waiting, track mute and track ended report actual playback transitions', async () => {
  const item = fixture(); render(<LiveCameraView authorized service={adapter({ 'GPS-001': item })} />);
  await opened('Pi1'); const video = progress('Pi1', 1);
  fireEvent.pause(video); expect(within(tile('Pi1')).getByText('Paused')).toBeInTheDocument();
  fireEvent.waiting(video); expect(within(tile('Pi1')).getByText('Video delayed')).toBeInTheDocument();
  progress('Pi1', 2); act(() => item.track.dispatchEvent(new Event('mute')));
  expect(within(tile('Pi1')).getByText('Video delayed')).toBeInTheDocument();
  act(() => item.track.dispatchEvent(new Event('ended')));
  expect(within(tile('Pi1')).getByText('Feed disconnected')).toBeInTheDocument();
  expect(item.close).toHaveBeenCalledTimes(1);
});

test('browser-decoded frame callback detects video activity and cancels on cleanup', async () => {
  const item = fixture(); const view = render(<LiveCameraView authorized service={adapter({ 'GPS-001': item })} />);
  const video = screen.getByLabelText('Pi1 live camera video'); let callback;
  video.requestVideoFrameCallback = jest.fn((fn) => { callback = fn; return 42; });
  video.cancelVideoFrameCallback = jest.fn();
  Object.defineProperty(video, 'paused', { value: false, configurable: true });
  await opened('Pi1'); act(() => callback());
  expect(within(tile('Pi1')).getByText('Receiving video')).toBeInTheDocument();
  view.unmount(); expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
  expect(item.close).toHaveBeenCalledTimes(1);
});

test('navigation, auth loss and adapter change release owned streams', async () => {
  const first = fixture(), second = fixture('GPS-002'); const service = adapter({ 'GPS-001': first, 'GPS-002': second });
  const view = render(<LiveCameraView authorized service={service} />);
  await opened('Pi1'); select('Pi2'); await opened('Pi2');
  view.rerender(<LiveCameraView service={service} />);
  expect(first.close).toHaveBeenCalledTimes(1); expect(second.close).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector('video')).toBeNull();
  const next = fixture(); service.open.mockResolvedValueOnce(next);
  view.rerender(<LiveCameraView authorized service={service} />);
  await opened('Pi1');
  view.rerender(<LiveCameraView authorized />);
  expect(next.close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(next.close).toHaveBeenCalledTimes(1);
});

test('hiding page preserves the owned stream without duplicate opens on return', async () => {
  const item = fixture(); const service = adapter({ 'GPS-001': item }); const view = render(<LiveCameraView authorized service={service} />);
  await opened('Pi1');
  const original = Object.getOwnPropertyDescriptor(document, 'hidden');
  try {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(item.close).not.toHaveBeenCalled(); expect(item.track.stop).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    fireEvent(document, new Event('visibilitychange')); expect(service.open).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Pi1 live camera video').srcObject).toBe(item.stream);
  } finally {
    if (original) Object.defineProperty(document, 'hidden', original); else delete document.hidden;
    view.unmount();
  }
});
