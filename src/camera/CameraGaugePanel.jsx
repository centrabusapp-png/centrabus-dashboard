import { useEffect, useRef, useState } from 'react';
import { cameraPanelState, deriveCameraPanel, validCameraCalibration } from './cameraReadings';
import { pendingCameraReadingsService } from './cameraReadingsService';
import { observeCameraDashboard } from './cameraMetrics';

export default function CameraGaugePanel({ busId, enabled = false, service = pendingCameraReadingsService,
  calibration = null, renderGauge, clock = Date.now, timeoutMs = 5000, metrics }) {
  const [request, setRequest] = useState({ busId: null, snapshot: null, status: 'Loading' });
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(clock);
  const measured = useRef({});
  useEffect(() => {
    if (!enabled || !busId || !validCameraCalibration(calibration)) return undefined;
    let active = true; const controller = new AbortController(); let timeout;
    setRequest({ busId, snapshot: null, status: 'Loading' });
    Promise.race([Promise.resolve().then(() => service.readLatest(busId, { signal: controller.signal })),
      new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, Math.min(5000, Math.max(1, timeoutMs))); })])
      .then((snapshot) => { if (active) { setRequest({ busId, snapshot, status: 'ready' }); setNow(clock()); } })
      .catch(() => { if (active) setRequest({ busId, snapshot: null, status: 'Unavailable' }); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [enabled, busId, service, calibration, refresh, clock, timeoutMs]);
  // Age locally; no polling/Realtime traffic. Explicit refresh performs bounded reads.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [enabled, clock]);
  const state = !validCameraCalibration(calibration) ? deriveCameraPanel(null, busId, calibration, now)
    : request.busId !== busId || request.status === 'Loading' ? cameraPanelState('Loading', 'Loading numerical gauge readings…')
    : request.status === 'Unavailable' ? cameraPanelState('Unavailable', 'Camera readings are unavailable. No normal/zero values are assumed.')
    : deriveCameraPanel(request.snapshot, busId, calibration, now);
  useEffect(() => {
    if (!enabled || !metrics || !validCameraCalibration(calibration) || request.busId !== busId) return;
    const prior = measured.current;
    const signature = `${state.status}:${state.gauges.map((gauge) => gauge.status).join(',')}`;
    const sameRequest = prior.request === request && prior.metrics === metrics;
    if (sameRequest && prior.signature === signature) return;
    measured.current = { request, metrics, signature };
    if (state.status === 'Unavailable') observeCameraDashboard(metrics, 'read_failures', 1);
    if (state.status === 'Invalid') observeCameraDashboard(metrics, 'invalid_states', 1);
    if (request.status !== 'ready' || ['Invalid', 'Loading'].includes(state.status)) return;
    const missing = state.gauges.filter((gauge) => gauge.numericValue == null).length;
    const stale = state.gauges.filter((gauge) => gauge.status === 'Stale').length;
    observeCameraDashboard(metrics, 'missing_readings', missing);
    observeCameraDashboard(metrics, 'stale_readings', stale);
    if (!state.gauges.length && state.status === 'Awaiting Data') observeCameraDashboard(metrics, 'missing_snapshots', 1);
    // Once per newly rendered valid reading, not every age tick. Clock skew is
    // reported separately; a future capture is never a fabricated zero latency.
    if (!sameRequest) for (const gauge of state.gauges) {
      if (gauge.numericValue == null || !gauge.capturedAt) continue;
      const elapsed = clock() - Date.parse(gauge.capturedAt);
      if (elapsed < 0) observeCameraDashboard(metrics, 'clock_skew_observations', 1);
      else observeCameraDashboard(metrics, 'dashboard_capture_latency_ms', elapsed);
    }
  }, [enabled, metrics, calibration, busId, request, state.status, state.gauges, clock]);
  if (!enabled) return null;
  return <div className="col-span-full min-w-0" aria-label="Camera gauge readings" data-testid="camera-gauge-panel">
    <div role="status" className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      <p className="font-extrabold">{state.status}</p><p>{state.message}</p>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {state.gauges.map((gauge) => <div key={gauge.id}>{renderGauge ? renderGauge(gauge) : <div role="group" aria-label={gauge.label}>
        <h4>{gauge.label}</h4><p>{gauge.numericValue != null ? `${gauge.numericValue} ${gauge.unit}` : 'Awaiting Data'}</p><p>{gauge.status}</p>
        {gauge.capturedAt && <p>Captured {gauge.capturedAt} · {Math.floor(gauge.ageMs / 1000)}s ago</p>}
      </div>}</div>)}
    </div>
    <button type="button" disabled={!validCameraCalibration(calibration) || state.status === 'Loading'}
      onClick={() => setRefresh((value) => value + 1)} className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-50">Refresh gauge readings</button>
  </div>;
}
