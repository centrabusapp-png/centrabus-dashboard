import { remoteWifiProxy } from './remoteWifiProxy.mjs';
import { readFileSync } from 'node:fs';

const { backendOrigin } = JSON.parse(readFileSync(new URL('./deployment/launch-profile.json', import.meta.url), 'utf8'));
const historyRoute = '^/api/camera-frames/buses/[^/?]{1,384}/history(?:\\?[^#]*)?$';

function historyProxy(proxy) {
  return { ...proxy, bypass: req => req.method === 'GET' ? false : req.url };
}

export function cameraFrameProxy(mode, env, addresses) {
  if (mode !== 'development') return {};
  const cloudHistory = historyProxy({ target: backendOrigin, changeOrigin: true, secure: true, followRedirects: false });
  if (env.VITE_CAMERA_FRAMES_ENABLED !== 'true') return { [historyRoute]: cloudHistory };
  // With camera frames enabled, live preview and history use the selected
  // own-laptop/private-IP backend. Otherwise only history GET uses Render.
  const own = Object.values(remoteWifiProxy(mode, { ...env, VITE_REMOTE_WIFI_ENABLED: 'true' }, addresses))[0];
  return {
    '^/api/camera-frames/devices/GPS-00[12]/(?:latest|live)(?:\\?preview=[01])?$': own,
    [historyRoute]: historyProxy(own),
  };
}
