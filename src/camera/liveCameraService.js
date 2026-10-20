// Deliberately not the historical Flask preview or camera inference service.
// A separately approved authenticated media adapter supplies receive-only
// MediaStreams. Never put a Pi password, camera token or arbitrary URL in <video>.
export const LIVE_CAMERA_DEVICES = Object.freeze([
  { deviceId: 'GPS-001', name: 'Raspberry Pi 1', shortName: 'Pi1' },
  { deviceId: 'GPS-002', name: 'Raspberry Pi 2', shortName: 'Pi2' },
]);

export const pendingLiveCameraService = Object.freeze({
  isConfigured: () => false,
  open: async () => { throw new Error('Live camera transport is not configured.'); },
});

export function cameraFeedConfigured(service, deviceId) {
  try { return LIVE_CAMERA_DEVICES.some((item) => item.deviceId === deviceId) && service?.isConfigured?.(deviceId) === true; }
  catch { return false; }
}

export function validLiveCameraSession(session, deviceId) {
  try {
    return session?.deviceId === deviceId && typeof session.cameraId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(session.cameraId)
      && typeof session.close === 'function'
      && Array.isArray(session.stream?.getTracks?.())
      && Array.isArray(session.stream?.getAudioTracks?.()) && session.stream.getAudioTracks().length === 0
      && Array.isArray(session.stream?.getVideoTracks?.()) && session.stream.getVideoTracks().length === 1
      && session.stream.getVideoTracks()[0]?.kind === 'video'
      && session.stream.getVideoTracks()[0]?.readyState === 'live';
  } catch { return false; }
}

export function disposeLiveCameraSession(session) {
  // Stop local media even if the transport's cleanup fails. No automatic retry,
  // command delivery, recording, microphone or device service operation.
  try { session?.stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch { /* continue cleanup */ } }); } catch { /* invalid session */ }
  try { Promise.resolve(session?.close?.()).catch(() => {}); } catch { /* adapter cleanup is best effort */ }
}
