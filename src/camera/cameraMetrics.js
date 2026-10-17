// Local, aggregate-only camera observations. No network exporter/browser storage.
const UNITS = Object.freeze({ dashboard_capture_latency_ms: 'ms', clock_skew_observations: 'count',
  missing_readings: 'count', stale_readings: 'count', missing_snapshots: 'count',
  invalid_states: 'count', read_failures: 'count' });
export function createCameraDashboardMetrics() {
  const values = new Map();
  return {
    observe(name, value) {
      if (!Object.hasOwn(UNITS, name) || typeof value !== 'number' || !Number.isFinite(value)
        || value < 0 || value > 1e15 || (UNITS[name] === 'count' && !Number.isSafeInteger(value))) return false;
      const old = values.get(name) || { samples: 0, total: 0, min: value, max: value };
      if (!Number.isSafeInteger(old.samples + 1) || !Number.isFinite(old.total + value)) return false;
      values.set(name, { samples: old.samples + 1, total: old.total + value,
        min: Math.min(old.min, value), max: Math.max(old.max, value) });
      return true;
    },
    snapshot() { return { scope: 'camera-dashboard', metrics: Object.fromEntries([...values].map(([key, value]) =>
      [key, { ...value, unit: UNITS[key], mean: value.total / value.samples }])) }; },
  };
}
export function observeCameraDashboard(metrics, name, value) {
  try { metrics?.observe(name, value)?.catch?.(() => {}); } catch { /* Monitoring must not affect display. */ }
}
