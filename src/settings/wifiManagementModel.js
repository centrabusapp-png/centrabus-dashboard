// Integration preparation only. No storage, requests or credential delivery.
export const WIFI_DEVICES = [
  { id: 'GPS-001', label: 'Pi1 · GPS-001' },
  { id: 'GPS-002', label: 'Pi2 · GPS-002' },
];
export const WIFI_SECURITY = ['wpa2-personal', 'wpa3-personal'];
export const WIFI_CONFIGURATION_STATES = {
  unknown: 'Not verified',
  pending: 'Pending device confirmation',
  applied: 'Applied · device confirmed',
  failed: 'Configuration failed',
  rollback_pending: 'Rollback pending',
  rolled_back: 'Rolled back · device confirmed',
  expired: 'Command expired · verify device state',
};

export function validateWifiPlan({ deviceId, ssid, password = '', priority, security }) {
  if (!WIFI_DEVICES.some((device) => device.id === deviceId)) return 'Choose a supported GPS device.';
  if (typeof ssid !== 'string' || !ssid.length || new TextEncoder().encode(ssid).length > 32 || /[\x00-\x1f\x7f]/.test(ssid)) {
    return 'SSID must contain 1–32 UTF-8 bytes without control characters.';
  }
  if (!WIFI_SECURITY.includes(security)) return 'Choose WPA2-Personal or WPA3-Personal.';
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) return 'Priority must be a whole number from 0 to 100.';
  // Password is optional for a disabled preview, never an applied profile. WPA2's
  // 64-hex PSK is distinct from a passphrase; do not trim either SSID or secret.
  if (typeof password !== 'string' || (password && !(/^[\x20-\x7e]{8,63}$/.test(password)
      || (security === 'wpa2-personal' && /^[0-9a-fA-F]{64}$/.test(password))))) {
    return 'Use an 8–63 character printable ASCII password, or a 64-digit hexadecimal WPA2 key.';
  }
  return '';
}

export function pendingWifiState(deviceId) {
  return { deviceId, integration: 'pending', profiles: null, configuration: 'unknown',
    reportedAt: null, wifiConnected: null, internetReachable: null };
}

export const pendingWifiService = Object.freeze({
  // Explicitly no network call. Real status delivery is a separate deployment.
  getState: async (deviceId) => pendingWifiState(deviceId),
});

export function wifiReportTimestamp(value) {
  // Require explicit UTC; never reinterpret a timezone-less device report as
  // browser-local time. The future status adapter must supply authenticated UTC.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    ? Date.parse(value) : NaN;
}

export function publicWifiState(result, deviceId) {
  if (result?.deviceId !== deviceId) throw new Error('wrong-device');
  const ready = result.integration === 'ready';
  return { ...pendingWifiState(deviceId), integration: ready ? 'ready' : 'pending',
    configuration: ready && Object.prototype.hasOwnProperty.call(WIFI_CONFIGURATION_STATES, result.configuration) ? result.configuration : 'unknown',
    reportedAt: ready && Number.isFinite(wifiReportTimestamp(result.reportedAt)) ? result.reportedAt : null,
    wifiConnected: ready && typeof result.wifiConnected === 'boolean' ? result.wifiConnected : null,
    internetReachable: ready && typeof result.internetReachable === 'boolean' ? result.internetReachable : null,
    profiles: ready && Array.isArray(result.profiles) ? result.profiles.slice(0, 8).filter((profile) =>
      !validateWifiPlan({ deviceId, ssid: profile?.ssid, security: profile?.security, priority: profile?.priority }))
      .map(({ ssid, priority, security }) => ({ ssid, priority, security })) : null };
}

export function wifiStatusPresentation(state, now = Date.now()) {
  const reportedAt = wifiReportTimestamp(state?.reportedAt);
  const age = now - reportedAt;
  const fresh = Number.isFinite(age) && age >= -2000 && age <= 90_000;
  return {
    management: state?.integration !== 'ready' ? 'Integration pending'
      : !Number.isFinite(age) || age < -2000 ? 'Unknown' : fresh ? 'Reporting' : 'Offline · last report expired',
    wifi: fresh && state?.integration === 'ready' && typeof state.wifiConnected === 'boolean'
      ? state.wifiConnected ? 'Connected' : 'Disconnected' : 'Unknown',
    internet: fresh && state?.integration === 'ready' && typeof state.internetReachable === 'boolean'
      ? state.internetReachable ? 'Reachable' : 'Not reachable' : 'Unknown',
    configuration: Object.prototype.hasOwnProperty.call(WIFI_CONFIGURATION_STATES, state?.configuration)
      ? WIFI_CONFIGURATION_STATES[state.configuration] : WIFI_CONFIGURATION_STATES.unknown,
  };
}
