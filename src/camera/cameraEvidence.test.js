import { canCaptureCameraEvidence, captureCameraEvidence, downloadCameraEvidence } from './cameraEvidence';
import { evidencePanel, mockEvidenceImages } from './testing/evidenceFixtures';

function options(overrides = {}) {
  const track = { kind: 'video', readyState: 'live', muted: false };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  return { deviceId: 'GPS-001', status: 'playing', lastActivity: 1000, now: 1500, gaugePanel: evidencePanel(),
    session: { deviceId: 'GPS-001', cameraId: 'test:camera.1', stream, close: () => {} },
    video: { srcObject: stream, readyState: 2, paused: false, ended: false, videoWidth: 1280, videoHeight: 720 },
    ...overrides };
}

let context;
beforeEach(() => {
  mockEvidenceImages();
  context = { fillRect: jest.fn(), drawImage: jest.fn(), fillText: jest.fn() };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['fixture'], { type: 'image/png' })));
});
afterEach(() => jest.restoreAllMocks());

test('copies the already decoded frame synchronously; PNG contains honest device and browser UTC labels', async () => {
  const input = options(); const result = captureCameraEvidence(input);
  expect(context.drawImage).toHaveBeenCalledWith(input.video, 0, 60, 1280, 720);
  const evidence = await result;
  expect(evidence.blob.type).toBe('image/png');
  expect(evidence.filename).toBe('centrabus-GPS-001-test_camera_1-1970-01-01T00-00-01-500Z.png');
  const text = context.fillText.mock.calls.map(([line]) => line).join('\n');
  expect(text).toContain('GPS-001'); expect(text).toContain('test:camera.1');
  expect(text).toContain('Browser snapshot UTC: 1970-01-01T00:00:01.500Z');
  expect(text).toContain('Original camera capture UTC: unavailable / not verified');
  expect(text).toContain('Not a new physical camera capture');
  expect(text).toContain('source-epoch match NOT VERIFIED');
  for (const title of ['Fuel', 'Oil', 'Coolant', 'Front air pressure', 'Battery', 'Rear air pressure']) expect(text).toContain(title);
  expect(text).toContain('1970-01-01T00:00:01.000Z');
  expect(context.drawImage).toHaveBeenCalledTimes(7);
});

test.each(['unconfigured', 'ready', 'connecting', 'connected', 'paused', 'buffering', 'stopped', 'failed', 'offline'])('%s playback cannot be evidence', async (status) => {
  const input = options({ status });
  expect(canCaptureCameraEvidence(input)).toBe(false);
  await expect(captureCameraEvidence(input)).rejects.toThrow('frame-unavailable');
  expect(context.drawImage).not.toHaveBeenCalled();
});

test.each([null, undefined, NaN, -2000, 1600])('missing, old or future activity %s is refused', (lastActivity) => {
  expect(canCaptureCameraEvidence(options({ lastActivity }))).toBe(false);
});

test('requires matching identity, live unmuted track and attached stream', () => {
  const input = options();
  expect(canCaptureCameraEvidence(input)).toBe(true);
  expect(canCaptureCameraEvidence({ ...input, deviceId: 'GPS-002' })).toBe(false);
  input.session.stream.getVideoTracks()[0].muted = true;
  expect(canCaptureCameraEvidence(input)).toBe(false);
  input.session.stream.getVideoTracks()[0].muted = false;
  input.session.stream.getVideoTracks()[0].readyState = 'ended';
  expect(canCaptureCameraEvidence(input)).toBe(false);
  expect(canCaptureCameraEvidence({ ...options(), video: { ...input.video, srcObject: {} } })).toBe(false);
});

test.each([{ readyState: 1 }, { paused: true }, { ended: true }, { videoWidth: 0 },
  { videoWidth: 9000 }, { videoHeight: 9000 }, { videoWidth: 4096, videoHeight: 4096 }])('refuses undecoded, stopped or unbounded frames: %p', (change) => {
  const input = options(); input.video = { ...input.video, ...change };
  expect(canCaptureCameraEvidence(input)).toBe(false);
});

test('long identity is preserved on bounded footer lines', async () => {
  const input = options(); input.video.videoWidth = 320;
  input.session.cameraId = 'A'.repeat(128);
  await captureCameraEvidence(input);
  expect(context.fillText.mock.calls.filter(([line]) => line.includes('A'.repeat(64)))).toHaveLength(2);
});

test('encoder null and canvas security failures are sanitized', async () => {
  HTMLCanvasElement.prototype.toBlob.mockImplementation((callback) => callback(null));
  await expect(captureCameraEvidence(options())).rejects.toThrow('capture-unavailable');
  context.drawImage.mockImplementation(() => { throw new Error('private-url-not-for-display'); });
  await expect(captureCameraEvidence(options())).rejects.toThrow('capture-unavailable');
});

test('hung encoding has an eight-second bound and late completion is ignored', async () => {
  jest.useFakeTimers();
  try {
    let complete; HTMLCanvasElement.prototype.toBlob.mockImplementation((callback) => { complete = callback; });
    const result = expect(captureCameraEvidence(options())).rejects.toThrow('capture-unavailable');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(8001); await result;
    complete(new Blob(['late'], { type: 'image/png' }));
  } finally { jest.useRealTimers(); }
});

test('download is local, filename scoped, object URL revoked after browser can consume it', () => {
  jest.useFakeTimers();
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  try {
    URL.createObjectURL = jest.fn(() => 'blob:local-fixture'); URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toBe('test.png'); expect(this.href).toBe('blob:local-fixture');
    });
    downloadCameraEvidence({ blob: new Blob(['test']), filename: 'test.png' });
    expect(click).toHaveBeenCalledTimes(1); expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-fixture');
  } finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; jest.useRealTimers(); }
});
