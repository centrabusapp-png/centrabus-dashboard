import { remoteWifiProxy } from './remoteWifiProxy.mjs';
export function cameraFrameProxy(mode, env, addresses) {
  if (mode !== 'development' || env.VITE_CAMERA_FRAMES_ENABLED !== 'true') return {};
  // Reuse the tested own-laptop/private-IP validation. GET only; uploads cannot
  // traverse this browser proxy and an arbitrary remote target is never accepted.
  const own = Object.values(remoteWifiProxy(mode, { ...env, VITE_REMOTE_WIFI_ENABLED: 'true' }, addresses))[0];
  return { '^/api/camera-frames/devices/GPS-00[12]/(?:latest|live)(?:\\?preview=[01])?$': own };
}
