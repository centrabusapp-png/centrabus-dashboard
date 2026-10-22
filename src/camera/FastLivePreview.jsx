import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';

// Latest-only, bounded-rate polling. No overlapping requests, frame history,
// localStorage, IndexedDB, service worker, recording or automatic download.
export default function FastLivePreview({ device, service, enabled, clock, decode, latestFrameRef, onAvailability }) {
  const [frame, setFrame] = useState(null);
  const [now, setNow] = useState(clock);
  const [reconnecting, setReconnecting] = useState(false);
  const last = useRef(null);
  useEffect(() => {
    let active = true, timer, controller = null, inFlight = false, generation = 0;
    const clearFrame = () => { last.current = null; latestFrameRef.current = null; setFrame(null); };
    setFrame(null); setReconnecting(false); last.current = null; latestFrameRef.current = null;
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
        const next = reply.state === 'live' ? reply.frame : null;
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
          setReconnecting(!next);
        }
      } catch (error) { if (active && request === generation) {
        const age=last.current ? clock()-Date.parse(last.current.captured_at) : Infinity;
        if(error?.message!=='camera-temporary-unavailable'||age>2000||age < -2000) clearFrame();
        setReconnecting(error?.message==='camera-temporary-unavailable');
      } }
      finally { inFlight = false; if (controller === currentController) controller = null;
        schedule(Math.max(0, 125 - (clock() - started))); }
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
  useEffect(() => { onAvailability(Boolean(fresh)); }, [fresh, onAvailability]);
  return <>
    <div className="camera-preview-viewport relative aspect-video w-full overflow-hidden bg-[#111827]" aria-label="Independent live preview">
      {fresh ? <img src={`data:image/jpeg;base64,${frame.image.base64}`} alt={`${device.shortName} live preview ${frame.capture_id}`}
        data-capture-id={frame.capture_id} className="h-full w-full object-contain" />
        : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300"><VideoOff size={36} />
          <strong>{enabled ? reconnecting ? 'Reconnecting to camera preview' : 'Waiting for live RAM-only camera' : 'Preview is off'}</strong></div>}
    </div>
    <p role="status" className="camera-preview-freshness px-5 pt-3 text-xs text-slate-500">{fresh
      ? reconnecting ? 'Reconnecting · last received frame · not recorded' : 'Live preview · RAM only · not recorded'
      : reconnecting ? 'Connection interrupted · waiting for a fresh frame' : 'No fresh live image'}
      {fresh && ` · frame age ${Math.max(0, now - Date.parse(frame.captured_at))} ms`}</p>
  </>;
}
