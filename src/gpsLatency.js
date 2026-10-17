// Opt-in, browser-local timing only. No GPS coordinates, payloads or credentials.
export function recordGpsLatency(stage, { busId, capturedAt, backendReceivedAt } = {}) {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem('centrabus.gpsLatencyDebug') !== '1') return;
    const events = Array.isArray(window.centrabusGpsLatency) ? window.centrabusGpsLatency : [];
    events.push({ stage, busId, capturedAt, backendReceivedAt, observedAt: Date.now() });
    window.centrabusGpsLatency = events.slice(-500);
  } catch { /* Private/restricted storage must never affect GPS rendering. */ }
}
