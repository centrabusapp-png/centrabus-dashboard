import { useEffect, useState } from 'react';
import { frameGauges } from './cameraFrameService';
import { AnimatedCameraGauge } from './LiveCameraGauges';

// Vehicle-condition page reads the SAME source snapshots as Live Camera View,
// not an independently recomputed interpretation or GPS-derived assignment.
export default function CameraFrameGaugePanel({ busId, service, clock = Date.now, compact = false }) {
  const [result, setResult] = useState({ state: 'waiting', frame: null });
  const [now, setNow] = useState(clock);
  useEffect(() => {
    let active = true; let timer; const controller = new AbortController();
    setResult({ state: 'waiting', frame: null });
    const poll = async () => {
      if (!document.hidden) try {
        const next = await service.readForBus(busId, { signal: controller.signal });
        if (next.frame && next.frame.bus_id !== busId) throw new Error('camera-bus-mismatch');
        if (active) { setResult(next); setNow(clock()); }
      } catch { if (active) setResult({ state: 'unavailable', frame: null }); }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    const age = setInterval(() => setNow(clock()), 1000);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearInterval(age); };
  }, [busId, service, clock]);
  if (compact) {
    const age = result.frame ? now - Date.parse(result.frame.captured_at) : null;
    const fresh = result.state === 'live' && Number.isFinite(age) && age >= -2000 && age <= 15000;
    const detected = result.frame?.readings.filter((reading) => reading.quality === 'detected').length || 0;
    const seconds = Number.isFinite(age) ? Math.max(0, Math.floor(age / 1000)) : null;
    const elapsed = seconds === null ? null : seconds < 60 ? `${seconds}s` : seconds < 3600
      ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
    const status = result.state === 'unavailable' ? 'Camera unavailable' : !result.frame ? 'Waiting for camera'
      : !fresh ? 'Readings out of date' : detected ? `${detected} of 6 detected` : 'No gauges detected';
    // Same freshness gate as Live Camera View: simplify the display without
    // presenting a last-known angle or value as a current measurement.
    const gauges = frameGauges(result.frame, now, result.state).map((gauge) => fresh ? gauge
      : { ...gauge, numericValue: null, angleDegrees: null, dialPositionPercent: null });
    return <div className="condition-camera-snapshot" aria-label="Same-capture gauge observations" data-capture-id={result.frame?.capture_id}>
      <p role="status" className="condition-camera-status" data-fresh={fresh}>
        <strong>{status}</strong>
        {elapsed !== null ? <time dateTime={result.frame.captured_at} title={result.frame.captured_at}>{fresh ? 'Fresh' : 'Stale'} · {elapsed} ago</time>
          : <span>No current readings</span>}
      </p>
      <div className="camera-condition-grid">{gauges.map((gauge) => <AnimatedCameraGauge compact key={gauge.gaugeKey} gauge={gauge} />)}</div>
    </div>;
  }
  return <div className="col-span-full" aria-label="Same-capture gauge observations" data-capture-id={result.frame?.capture_id}>
    <div role="status" className="camera-condition-source"><div><strong>{result.frame?.readings.some((r) => r.quality === 'detected')
      ? 'Detected observations · Interpretation unverified' : 'Gauges not detected · No values assumed'}</strong>
      <p>{result.state === 'unavailable' ? 'Camera data unavailable; no zero/Normal assumptions.' : result.frame
        ? `${result.frame.device_id} · Capture ${result.frame.capture_id} · ${result.frame.captured_at}` : 'Waiting for a camera registered to this bus.'}</p></div></div>
    <div className="camera-condition-grid">{frameGauges(result.frame, now, result.state).map((gauge) => <AnimatedCameraGauge key={gauge.gaugeKey} gauge={gauge} />)}</div>
  </div>;
}
