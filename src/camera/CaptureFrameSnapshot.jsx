import { useEffect, useRef } from 'react';
import { frameGauges } from './cameraFrameService';
import { AnimatedCameraGauge } from './LiveCameraGauges';
import { captureSynchronizedFrame } from './cameraEvidence';

// Exists only after an explicit Capture click. Freeze one image + six matching
// observations in memory so live polling cannot change the requested PNG.
export default function CaptureFrameSnapshot({ frame, deviceId, clock, onDone }) {
  const image = useRef(null), panel = useRef(null);
  useEffect(() => {
    let active = true, begun = false, finished = false;
    const finish = (result, failure) => {
      if (!active || finished) return;
      finished = true; clearTimeout(timer); onDone(result, failure);
    };
    const timer = setTimeout(() => finish(null, 'png-timeout'), 8000);
    const take = async () => {
      if (!active || begun || !image.current?.complete || !image.current?.naturalWidth) return;
      begun = true;
      try { finish(await captureSynchronizedFrame({ image: image.current, panel: panel.current, frame, deviceId, now: clock() })); }
      catch { finish(null, 'png-composition'); }
    };
    const node = image.current; node.addEventListener('load', take);
    const failed = () => finish(null, 'image-decode'); node.addEventListener('error', failed);
    // StrictMode replays effects in development. A cached data URL can already
    // be complete on the first setup: defer work until the replay has cleaned
    // it up, and keep the attempt guard local to the active setup. Otherwise
    // the abandoned attempt leaves a persistent ref locked until timeout.
    void Promise.resolve().then(take);
    return () => { active = false; clearTimeout(timer); node.removeEventListener('load', take); node.removeEventListener('error', failed); };
  }, [frame, deviceId, clock, onDone]);
  return <div aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0, width: '900px', pointerEvents: 'none' }}>
    <img ref={image} alt="" src={`data:image/jpeg;base64,${frame.image.base64}`} data-capture-id={frame.capture_id} />
    <section ref={panel} data-device-id={deviceId} data-capture-id={frame.capture_id}>
      <p className="camera-section-detail">{deviceId} · Bus {frame.bus_id}</p>
      <div className="camera-condition-source"><strong>Matching source capture · Physical accuracy unverified</strong></div>
      {frameGauges(frame, clock()).map(g => <AnimatedCameraGauge key={g.gaugeKey} gauge={g} />)}
    </section>
  </div>;
}
