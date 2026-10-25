// Public browser configuration only. Never put a device credential here.
function localAddress(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host.includes('*') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80:')
    || /^(?:0|10|127)\./.test(host) || /^169\.254\./.test(host)
    || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
}

export function resolveBackendConfig({
  nodeEnv = process.env.NODE_ENV,
  backendUrl = process.env.VITE_BACKEND_URL,
  legacyGpsUrl = process.env.VITE_GPS_INGESTION_URL,
  wifiStatusEnabled = process.env.VITE_WIFI_STATUS_ENABLED,
  devicePresenceEnabled = process.env.VITE_DEVICE_PRESENCE_ENABLED,
  remoteWifiEnabled = process.env.VITE_REMOTE_WIFI_ENABLED,
  localNetworkRecovery = process.env.VITE_LOCAL_NETWORK_RECOVERY,
  cloudCameraMode = process.env.VITE_CLOUD_CAMERA_MODE,
} = {}) {
  const production = nodeEnv === 'production';
  const explicit = typeof backendUrl === 'string' && backendUrl.trim() !== '';
  // The old GPS-endpoint option is a DEVELOPMENT compatibility path only.
  const legacy = !explicit && !production && typeof legacyGpsUrl === 'string' && legacyGpsUrl.trim() !== '';
  const raw = explicit ? backendUrl : legacy ? legacyGpsUrl : production ? null : 'http://localhost:5000';
  let origin = null;
  let reason = raw == null ? 'missing' : 'invalid';
  if (raw != null) {
    try {
      const url = new URL(raw.trim());
      const expectedPath = legacy ? /^\/api\/gps\/update\/?$/ : /^\/?$/;
      const allowedProtocol = production ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol);
      if (allowedProtocol && !url.username && !url.password && !url.search && !url.hash
          && expectedPath.test(url.pathname) && (!production || !localAddress(url.hostname))) {
        origin = url.origin;
        reason = null;
      }
    } catch { /* Invalid deployment values never become relative requests. */ }
  }
  return Object.freeze({
    cloudCameraEnabled: production && origin !== null && cloudCameraMode === 'approved-cloud-gps-camera',
    configured: origin !== null,
    origin,
    reason,
    healthUrl: origin ? `${origin}/health` : null,
    wifiStatusBaseUrl: origin ? `${origin}/api/wifi-management/devices` : null,
    wifiStatusEnabled: wifiStatusEnabled === 'true',
    devicePresenceEnabled: devicePresenceEnabled === 'true',
    remoteWifiEnabled: remoteWifiEnabled === 'true' && !production,
    localNetworkRecoveryEnabled: localNetworkRecovery === 'true' && !production && origin === 'http://127.0.0.1:5000',
  });
}

export const BACKEND_CONFIG = resolveBackendConfig();
