import { cameraFeedConfigured, disposeLiveCameraSession, pendingLiveCameraService, validLiveCameraSession } from './liveCameraService';

function session(overrides = {}) {
  const video = { kind: 'video', readyState: 'live', stop: jest.fn() };
  return { deviceId: 'GPS-001', cameraId: 'test-camera-1', close: jest.fn(),
    stream: { getTracks: () => [video], getVideoTracks: () => [video], getAudioTracks: () => [] }, ...overrides };
}

test('unconfigured default cannot enable either real camera', async () => {
  expect(cameraFeedConfigured(pendingLiveCameraService, 'GPS-001')).toBe(false);
  expect(cameraFeedConfigured(pendingLiveCameraService, 'GPS-002')).toBe(false);
  await expect(pendingLiveCameraService.open()).rejects.toThrow('not configured');
});

test('availability requires the exact known device and explicit adapter support', () => {
  expect(cameraFeedConfigured({ isConfigured: () => true }, 'GPS-001')).toBe(true);
  expect(cameraFeedConfigured({ isConfigured: () => true }, 'GPS-003')).toBe(false);
  expect(cameraFeedConfigured({ isConfigured: () => 'true' }, 'GPS-001')).toBe(false);
  expect(cameraFeedConfigured({ isConfigured: () => { throw new Error('internal'); } }, 'GPS-001')).toBe(false);
});

test('only a correctly associated, live, video-only session is accepted', () => {
  expect(validLiveCameraSession(session(), 'GPS-001')).toBe(true);
});

test.each([null, { deviceId: 'GPS-002' }, { cameraId: '' }, { cameraId: 'http://camera?token=fixture' },
  { close: null }, { stream: null }, { stream: { getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] } },
  { stream: { getTracks: () => [], getVideoTracks: () => [{ kind: 'video', readyState: 'ended' }], getAudioTracks: () => [] } },
  { stream: { getTracks: () => [], getVideoTracks: () => [{ kind: 'video', readyState: 'live' }], getAudioTracks: () => [{}] } },
])('invalid or mismatched session is not playable: %o', (change) => {
  expect(validLiveCameraSession(change === null ? null : session(change), 'GPS-001')).toBe(false);
});

test('cleanup stops media even when transport cleanup fails', () => {
  const item = session({ close: () => { throw new Error('transport'); } });
  const track = item.stream.getTracks()[0];
  expect(() => disposeLiveCameraSession(item)).not.toThrow(); expect(track.stop).toHaveBeenCalledTimes(1);
});

test('one bad track cannot prevent other tracks from being stopped', () => {
  const stop = jest.fn(); const close = jest.fn();
  disposeLiveCameraSession({ stream: { getTracks: () => [{ stop: () => { throw new Error('bad'); } }, { stop }] }, close });
  expect(stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});
