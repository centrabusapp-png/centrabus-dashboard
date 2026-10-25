import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
const noop = () => {};

// Latest-only, bounded-rate polling. No overlapping requests, frame history,
// localStorage, IndexedDB, service worker, recording or automatic download.
export default function FastLivePreview({ device, service, enabled, clock, decode, latestFrameRef, onAvailability, onStateChange = noop }) {
  const [frame, setFrame] = useState(null);
  const [now, setNow] = useState(clock);
  const [previewState, setPreviewState] = useState('waiting');
  const last = useRef(null);
  useEffect(() => {
    let active = true, timer, controller = null, inFlight = false, generation = 0;
    const clearFrame = () => { last.current = null; latestFrameRef.current = null; setFrame(null); };
    setFrame(null); setPreviewState('waiting'); last.current = null; latestFrameRef.current = null;
    if (!enabled) return undefined;
    const schedule = (delay) => {
      clearTimeout(timer);
      if (active && !document.hidden) timer = setTimeout(poll, delay);
    };
    async function poll() {
      if (!active || document.hidden || inFlight) return;
      inFlight = true;
      const request = ++generation;
      const currentController = new AbortController(); controller = currentController;
      const started = clock();
      try {
        const reply = await service.readLive(device.deviceId, { signal: currentController.signal, preview: true });
        let next = reply.state === 'live' ? reply.frame : null;
        const previousAge = last.current ? clock() - Date.parse(last.current.captured_at) : Infinity;
        const waitingBriefly = reply.state === 'waiting' && previousAge >= -2000 && previousAge <= 2000;
        if (waitingBriefly) next = last.current;
        if (next?.image.base64) {
          const age = clock() - Date.parse(next.captured_at);
          if (age > 2000 || age < -2000) throw Error('stale-live-frame');
          if (last.current && next.bus_id === last.current.bus_id && next.camera_id === last.current.camera_id
            && Date.parse(next.captured_at) < Date.parse(last.current.captured_at)) throw Error('old-live-frame');
          if (next.capture_id !== last.current?.capture_id || next.camera_id !== last.current?.camera_id || next.bus_id !== last.current?.bus_id) {
            await decode(`data:image/jpeg;base64,${next.image.base64}`, currentController.signal);
          }
        }
        if (active && request === generation && !document.hidden) {
          last.current = next; latestFrameRef.current = next; setFrame(next); setNow(clock());
          setPreviewState(reply.state === 'not-enrolled' ? 'not-enrolled' : waitingBriefly ? 'reconnecting' : next ? 'live' : 'waiting');
        }
      } catch (error) { if (active && request === generation) {
        const age=last.current ? clock()-Date.parse(last.current.captured_at) : Infinity;
        const temporary = error?.message === 'camera-temporary-unavailable';
        if (!temporary || age > 2000 || age < -2000) clearFrame();
        setPreviewState(temporary ? 'reconnecting' : 'unavailable');
      } }
      finally { inFlight = false; if (controller === currentController) controller = null;
        // Four reads/second is enough for aiming and halves repeated JPEG/auth
        // requests. It does not change camera capture or gauge-analysis quality.
        schedule(Math.max(0, 250 - (clock() - started))); }
    }
    const hidden = () => {
      if (document.hidden) { ++generation; clearTimeout(timer); controller?.abort(); clearFrame(); }
      else schedule(0);
    };
    document.addEventListener('visibilitychange', hidden);
    void poll();
    return () => { active = false; ++generation; clearTimeout(timer); controller?.abort(); last.current = null; latestFrameRef.current = null; document.removeEventListener('visibilitychange', hidden); };
  }, [device.deviceId, service, enabled, clock, decode, latestFrameRef]);
  useEffect(() => { const timer = setInterval(() => setNow(clock()), 250); return () => clearInterval(timer); }, [clock]);
  const fresh = enabled && frame && now - Date.parse(frame.captured_at) <= 2000 && now - Date.parse(frame.captured_at) >= -2000;
  useEffect(() => { onStateChange(previewState); }, [previewState, onStateChange]);
  const headline = !enabled ? 'Preview is off'
    : previewState === 'reconnecting' ? 'Reconnecting to camera preview'
      : previewState === 'not-enrolled' ? 'Camera not enrolled'
        : previewState === 'unavailable' ? 'Preview service unavailable'
          : `Waiting for ${device.shortName} camera publisher`;
  const status = previewState === 'reconnecting' ? 'Connection interrupted · retrying for a fresh frame'
    : previewState === 'not-enrolled' ? 'Camera enrollment is required before Pi frames can be accepted'
      : previewState === 'unavailable' ? 'Could not read the live preview service · check the laptop backend and sign-in'
        : 'Waiting for a fresh RAM-only camera frame';
  useEffect(() => { onAvailability(Boolean(fresh)); }, [fresh, onAvailability]);
  return <>
    <div className="camera-preview-viewport relative aspect-video w-full overflow-hidden bg-[#111827]" aria-label="Independent live preview">
      {fresh ? <img src={`data:image/jpeg;base64,${frame.image.base64}`} alt={`${device.shortName} live preview ${frame.capture_id}`}
        data-capture-id={frame.capture_id} className="h-full w-full object-contain" />
        : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300"><VideoOff size={36} />
          <strong>{headline}</strong></div>}
    </div>
    <p role="status" className="camera-preview-freshness px-5 pt-3 text-xs text-slate-500">{fresh
      ? previewState === 'reconnecting' ? 'Reconnecting · last received frame · not recorded' : 'Live preview · RAM only · not recorded'
      : status}
      {fresh && ` · frame age ${Math.max(0, now - Date.parse(frame.captured_at))} ms`}</p>
  </>;
}
