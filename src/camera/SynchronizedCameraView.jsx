import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Download, MonitorPlay, VideoOff } from 'lucide-react';
import { LIVE_CAMERA_DEVICES } from './liveCameraService';
import { AnimatedCameraGauge } from './LiveCameraGauges';
import { frameGauges } from './cameraFrameService';
import { captureSynchronizedFrame, downloadCameraEvidence } from './cameraEvidence';
import FastLivePreview from './FastLivePreview';
import CaptureFrameSnapshot from './CaptureFrameSnapshot';

export function decodePreview(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image(); let done = false;
    const finish = (error) => { if (done) return; done = true; clearTimeout(timer);
      signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null;
      if (error) { image.src = ''; reject(error); } else resolve(); };
    const abort = () => finish(new Error('preview-cancelled'));
    const timer = setTimeout(() => finish(new Error('preview-decode-timeout')), 3000);
    image.onload = () => finish(); image.onerror = () => finish(new Error('preview-decode-failed'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else image.src = url;
  });
}
function DeviceFrames({ device, service, clock, decode = decodePreview }) {
  const [preview, setPreview] = useState(false);
  const [data, setData] = useState({ state: 'waiting', frame: null });
  const [status, setStatus] = useState('Waiting for an authenticated camera capture.');
  const [now, setNow] = useState(clock);
  const [capture, setCapture] = useState('');
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [captureFrame, setCaptureFrame] = useState(null);
  const liveFrame = useRef(null);
  const fast = service.fastPreview === true && typeof service.readLive === 'function';
  const image = useRef(null); const panel = useRef(null); const downloading = useRef(false);
  const mounted = useRef(true); const viewing = useRef(preview); viewing.current = preview;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef(data); current.current = data;
  useEffect(() => {
    let active = true; let timer; const controller = new AbortController();
    if (!preview) return () => { active = false; controller.abort(); };
    async function poll() {
      if (document.hidden) { timer = setTimeout(poll, 1000); return; }
      try {
        const next = await service.read(device.deviceId, { signal: controller.signal, preview });
        if (next.frame?.image.base64 && preview) {
          // Decode first, then atomically adopt image + readings from this bundle.
          await decode(`data:image/jpeg;base64,${next.frame.image.base64}`, controller.signal);
        }
        if (!active) return;
        const prior = current.current.frame;
        if (prior && next.frame && prior.camera_id === next.frame.camera_id
          && prior.bus_id === next.frame.bus_id && Date.parse(next.frame.captured_at) < Date.parse(prior.captured_at)) throw new Error('out-of-order-frame');
        setData(next); setNow(clock());
        const detected = next.frame?.readings.some((reading) => reading.quality === 'detected');
        setStatus(next.state === 'not-enrolled' ? 'Camera enrollment required.' : next.state === 'waiting'
          ? 'No camera capture received yet.' : next.state === 'last-known'
            ? 'Last-known readings only. No matching live preview is available.' : detected
              ? 'Same-capture preview and six observations · Interpretation unverified'
              : 'Camera preview received. Gauges not detected in this capture; no values are assumed.');
      } catch {
        if (active) { setData({ state: 'unavailable', frame: null }); setStatus('Camera unavailable. Check schema, camera enrollment and publisher; no values are assumed.'); }
      } finally { if (active) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [device.deviceId, service, preview, clock, decode]);
  useEffect(() => { const timer = setInterval(() => setNow(clock()), 1000); return () => clearInterval(timer); }, [clock]);
  useEffect(() => { const hidden = () => { if (document.hidden) {
    setCaptureFrame(null); downloading.current = false; setLiveAvailable(false);
  } };
    document.addEventListener('visibilitychange', hidden); return () => document.removeEventListener('visibilitychange', hidden); }, []);
  const frame = data.frame;
  const fresh = preview && data.state === 'live' && frame && now - Date.parse(frame.captured_at) <= 15000 && now - Date.parse(frame.captured_at) >= -2000;
  const showing = preview && fresh && frame.image.base64;
  const detected = frame?.readings.some((reading) => reading.quality === 'detected');
  const gauges = frameGauges(fresh ? frame : null, now, fresh ? 'live' : 'waiting');
  const togglePreview = () => {
    viewing.current = !preview;
    setData({state:'waiting',frame:null});setCaptureFrame(null);setCapture('');
    downloading.current=false;liveFrame.current=null;setLiveAvailable(false);
    setStatus('Waiting for a new authenticated camera analysis.');setPreview(!preview);
  };
  const analysisWaiting = fast && liveAvailable && !frame;
  const save = async () => {
    if ((!showing && !(fast && preview && liveAvailable)) || downloading.current) return;
    if (fast) {
      const selected = showing ? frame : liveFrame.current;
      const limit = showing ? 15000 : 2000;
      if (!selected || clock() - Date.parse(selected.captured_at) > limit || clock() < Date.parse(selected.captured_at) - 2000) return;
      downloading.current = true; setCapture(showing ? 'Preparing matched analysis image + readings…' : 'Preparing live image only; older gauge values are not copied…'); setCaptureFrame(selected); return;
    }
    downloading.current = true; setCapture('Preparing PNG…'); const selected = frame;
    try {
      const result = await captureSynchronizedFrame({ image: image.current, panel: panel.current, frame: selected, deviceId: device.deviceId, now: clock() });
      if (!mounted.current || !viewing.current || current.current.frame?.camera_id !== selected.camera_id
        || current.current.frame?.bus_id !== selected.bus_id || document.hidden) return;
      downloadCameraEvidence(result); setCapture('PNG download requested.');
    } catch { setCapture('Capture unavailable; wait for a fresh matched preview.'); }
    finally { downloading.current = false; }
  };
  const finishCapture = useCallback(async (result, failure) => {
    const selected=captureFrame;
    setCaptureFrame(null);
    try{
      if(!mounted.current||!viewing.current||document.hidden||!result||!selected)throw Error(failure||'capture-unavailable');
      if(typeof service.saveCapture==='function'){
        setCapture('Saving PNG to captured-images…');
        const saved=await service.saveCapture(selected,result);
        if(mounted.current)setCapture(`Saved: ${saved.relativePath}`);
      }else{
        downloadCameraEvidence(result);setCapture('Matching PNG download requested.');
      }
    }catch(error){if(mounted.current){
      const reason={
        'png-timeout':'PNG preparation timed out', 'png-composition':'PNG composition failed',
        'image-decode':'camera image could not be decoded',
        'capture-save-http-403':'local save authorization was denied',
        'capture-save-http-503':'camera authorization is temporarily unavailable',
        'capture-save-http-400':'local save rejected the PNG or folder',
        'capture-save-http-429':'another capture is still saving',
        'capture-auth-required':'sign in again before saving',
      }[error?.message]||'save could not be confirmed';
      setCapture(`Capture not saved: ${reason}. Try Capture again.`);
    }}
    finally{downloading.current=false;}
  }, [captureFrame,service]);
  return <div className="live-camera-workspace" role="tabpanel" id="camera-device-workspace" aria-labelledby={`camera-tab-${device.deviceId}`}>
    <section className="camera-preview-panel min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm" aria-label={`${device.shortName} camera`}>
      <header className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="camera-section-eyebrow">Live camera preview</p><h2 className="font-extrabold">{device.name}</h2><p className="text-xs text-slate-500">{device.deviceId} · {frame?.camera_id || 'Camera not verified'}</p></div>
        <span role="status" className="text-xs font-bold">{fast
          ? liveAvailable ? 'Camera preview live' : 'Waiting for camera preview'
          : fresh ? 'Receiving captures' : frame ? 'Last known · stale' : 'Not receiving'}</span></header>
      {fast ? <FastLivePreview device={device} service={service} enabled={preview} clock={clock} decode={decode} latestFrameRef={liveFrame} onAvailability={setLiveAvailable} /> : <div className="relative aspect-video w-full overflow-hidden bg-[#111827]">
        {showing ? <img ref={image} src={`data:image/jpeg;base64,${frame.image.base64}`} alt={`${device.shortName} capture ${frame.capture_id}`}
          data-capture-id={frame.capture_id} className="h-full w-full object-contain" />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300"><VideoOff size={36} /><strong>{preview ? 'No fresh matching preview' : 'Preview is off'}</strong><span className="text-xs">Gauge observations update independently of the preview switch.</span></div>}
      </div>}
      {fast && <div className="px-5 pt-3 text-xs text-slate-500"><strong>{showing ? 'Capture source · matched analysis image + six gauge states' : 'Capture source · current live image only'}</strong>
        <p>{showing ? `Capture saves this analysis image with its own readings${service.saveCapture ? ' in captured-images' : ''}, not the newer preview above.`
          : 'No fresh matching analysis image is available. Capture saves the live image without older gauge values.'}</p>
        {showing && <img ref={image} src={`data:image/jpeg;base64,${frame.image.base64}`}
          data-capture-id={frame.capture_id} alt={`${device.shortName} matching analysis ${frame.capture_id}`} className="mt-2 max-h-32 rounded object-contain" />}
      </div>}
      <div className="space-y-3 p-5"><button type="button" role="switch" aria-checked={preview} onClick={togglePreview} className="rounded-xl border px-4 py-2 text-sm font-bold">Preview {preview ? 'on' : 'off'}</button>
        <button type="button" disabled={!showing && !(fast && preview && liveAvailable)} onClick={save} className="ml-3 inline-flex items-center gap-2 rounded-xl bg-[#8e1f2f] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Download size={16} />Capture</button>
        {capture && <p role="status" className="text-xs text-slate-500">{capture}</p>}
        <p className="text-xs text-slate-500">Preview off clears the image and all six displayed readings. This does not power down the Pi camera.</p>
        <p className="break-all text-xs text-slate-500">{fast ? 'Analysis capture' : 'Capture'}: {frame?.capture_id || '—'}<br />Original capture UTC: {frame?.captured_at || '—'}</p>
      </div>
    </section>
    <section ref={panel} data-device-id={device.deviceId} data-capture-id={frame?.capture_id} aria-label={`${device.shortName} vehicle condition`} className="camera-condition-panel">
      <header className="camera-condition-heading"><div><p className="camera-section-eyebrow">Camera-derived observations</p><h2>Vehicle condition monitoring</h2><p className="camera-section-detail">{device.deviceId} · Bus {frame?.bus_id || 'not verified'}</p></div><span className="camera-six-gauges">6 gauges</span></header>
      <div className="camera-condition-body"><div role="status" className="camera-condition-source"><div><strong>{!preview ? 'Preview off · Readings hidden' : fresh ? detected ? 'Detected values · not calibrated' : 'Camera active · Gauges not detected' : frame ? 'Analysis stale · Values withheld' : analysisWaiting ? 'Camera live · Awaiting gauge analysis' : 'Awaiting camera'}</strong><p>{!preview ? 'Turn Preview on to receive and display camera observations.' : analysisWaiting ? 'Live camera frames are arriving. No accepted gauge analysis has been received yet.' : status}</p>
        {preview && !fresh && frame && <p>No fresh matching analysis. Older values are withheld, not copied onto a newer image.</p>}
      </div></div>
        <p role="status" className="mb-3 break-all text-xs text-slate-500">{!preview ? 'Freshness: Off' : frame ? <>{fresh ? 'Fresh' : 'Stale'} · {Math.max(0,Math.floor((now-Date.parse(frame.captured_at))/1000))}s since capture · <time dateTime={frame.captured_at}>{new Date(frame.captured_at).toLocaleTimeString()}</time></> : 'Freshness: Waiting for camera analysis'}</p>
        <div className="camera-condition-grid">{gauges.map((gauge) => <AnimatedCameraGauge key={gauge.gaugeKey} gauge={gauge} />)}</div>
      </div>
    </section>
    {captureFrame && <CaptureFrameSnapshot frame={captureFrame} deviceId={device.deviceId} clock={clock} onDone={finishCapture} />}
  </div>;
}
export default function SynchronizedCameraView({ service, clock = Date.now, decode }) {
  const [deviceId, setDeviceId] = useState('GPS-001');
  const device = LIVE_CAMERA_DEVICES.find((row) => row.deviceId === deviceId);
  return <section aria-label="Live Camera View" className="space-y-4"><div className="live-camera-toolbar"><div className="flex items-center gap-3"><MonitorPlay size={22} /><div><h2 className="font-extrabold">Camera & vehicle condition</h2><p className="text-xs text-slate-500">Live preview and independently analyzed gauges. Pictures save only when you click Capture.</p></div></div>
    <div className="live-camera-tabs" role="tablist" aria-label="Camera device">{LIVE_CAMERA_DEVICES.map((item) => <button type="button" role="tab" aria-selected={item.deviceId === deviceId}
      id={`camera-tab-${item.deviceId}`} aria-controls="camera-device-workspace" tabIndex={item.deviceId===deviceId?0:-1}
      key={item.deviceId} className="live-camera-tab" onClick={() => setDeviceId(item.deviceId)}
      onKeyDown={(event)=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        event.preventDefault();const next=event.key==='Home'?LIVE_CAMERA_DEVICES[0]:event.key==='End'?LIVE_CAMERA_DEVICES[1]:LIVE_CAMERA_DEVICES.find(row=>row.deviceId!==deviceId);
        setDeviceId(next.deviceId);document.getElementById(`camera-tab-${next.deviceId}`)?.focus();
      }}}><Camera size={17} /><span>{item.shortName}<small>{item.deviceId}</small></span></button>)}</div></div>
    <DeviceFrames key={deviceId} device={device} service={service} clock={clock} decode={decode} />
  </section>;
}
