import { useEffect, useState } from 'react';
import { frameGauges } from './cameraFrameService';
import { AnimatedCameraGauge } from './LiveCameraGauges';

// Vehicle-condition page reads the SAME source snapshots as Live Camera View,
// not an independently recomputed interpretation or GPS-derived assignment.
export default function CameraFrameGaugePanel({ busId, service, clock = Date.now }) {
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
  return <div className="col-span-full" aria-label="Same-capture gauge observations" data-capture-id={result.frame?.capture_id}>
    <div role="status" className="camera-condition-source"><div><strong>{result.frame?.readings.some((r) => r.quality === 'detected')
      ? 'Detected observations · Interpretation unverified' : 'Gauges not detected · No values assumed'}</strong>
      <p>{result.state === 'unavailable' ? 'Camera data unavailable; no zero/Normal assumptions.' : result.frame
        ? `${result.frame.device_id} · Capture ${result.frame.capture_id} · ${result.frame.captured_at}` : 'Waiting for a camera registered to this bus.'}</p></div></div>
    <div className="camera-condition-grid">{frameGauges(result.frame, now, result.state).map((gauge) => <AnimatedCameraGauge key={gauge.gaugeKey} gauge={gauge} />)}</div>
  </div>;
}
