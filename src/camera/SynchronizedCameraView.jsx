import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Download, MonitorPlay, VideoOff } from 'lucide-react';
import { LIVE_CAMERA_DEVICES } from './liveCameraService';
import { AnimatedCameraGauge } from './LiveCameraGauges';
import { frameGauges } from './cameraFrameService';
import { captureSynchronizedFrame, downloadCameraEvidence } from './cameraEvidence';
import FastLivePreview from './FastLivePreview';
import CaptureFrameSnapshot from './CaptureFrameSnapshot';
import { createCameraReadingsCsv } from './cameraReadingsCsv';
import ConditionHistoryExport from './ConditionHistoryExport';
import { cameraDeviceAssociation } from './liveCameraGaugeModel';

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
// Local launchers can preselect the Pi they are starting. This selection never
// grants camera authorization; normal dashboard auth/enrollment still applies.
export function launcherPreviewDevice(location = window.location, development = process.env.NODE_ENV !== 'production') {
  if (!development || !['localhost', '127.0.0.1'].includes(location.hostname) || location.pathname !== '/live-camera') return null;
  const selected = new URLSearchParams(location.search).get('startup');
  return selected === 'pi1' ? 'GPS-001' : selected === 'pi2' ? 'GPS-002' : null;
}
function DeviceFrames({ device, service, clock, decode = decodePreview, bus, historyService }) {
  const preview = true;
  const [data, setData] = useState({ state: 'waiting', frame: null });
  const [status, setStatus] = useState('Waiting for an authenticated camera capture.');
  const [now, setNow] = useState(clock);
  const [capture, setCapture] = useState('');
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [livePreviewState, setLivePreviewState] = useState('waiting');
  const [captureFrame, setCaptureFrame] = useState(null);
  const liveFrame = useRef(null);
  const fast = service.fastPreview === true && typeof service.readLive === 'function';
  const image = useRef(null); const panel = useRef(null); const downloading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef(data); current.current = data;
  useEffect(() => {
    let active = true; let timer; const controller = new AbortController();
    if (service.previewOnly === true) {
      setData({ state: 'waiting', frame: null });
      setStatus('Preview-only mode. Gauge analysis and saved readings are disabled.');
      return () => { active = false; controller.abort(); clearTimeout(timer); };
    }
    async function poll() {
      if (document.hidden) { timer = setTimeout(poll, 1000); return; }
      try {
        const next = await service.read(device.deviceId, { signal: controller.signal, preview });
        if (next.frame?.image.base64) {
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
              ? 'Same-capture needle positions · Physical accuracy unverified'
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
  const fresh = data.state === 'live' && frame && now - Date.parse(frame.captured_at) <= 15000 && now - Date.parse(frame.captured_at) >= -2000;
  const showing = fresh && frame.image.base64;
  const detected = frame?.readings.some((reading) => reading.quality === 'detected');
  const gauges = frameGauges(fresh ? frame : null, now, fresh ? 'live' : 'waiting');
  const csvReady = Boolean(fresh && detected);
  const tripExportReady = Boolean(historyService?.enabled && bus?.id);
  const exportCsv = () => {
    if (!csvReady || document.hidden) return;
    try {
      // Freeze this rendered source bundle synchronously; no additional read,
      // inference, backend write, image save or older reading is involved.
      const result = createCameraReadingsCsv({ frame, deviceId: device.deviceId, state: data.state, now: clock() });
      downloadCameraEvidence(result); setCapture('CSV download requested.');
    } catch { setCapture('CSV unavailable; wait for fresh readings.'); }
  };
  const analysisWaiting = fast && liveAvailable && !frame;
  const previewStatus = livePreviewState === 'not-enrolled' ? 'Camera not enrolled'
    : livePreviewState === 'reconnecting' ? 'Reconnecting to camera preview'
      : livePreviewState === 'unavailable' ? 'Preview service unavailable'
        : livePreviewState === 'live' ? 'Camera preview live'
          : `Waiting for ${device.shortName} camera publisher`;
  const conditionStatus = service.previewOnly === true
    ? livePreviewState === 'not-enrolled' ? 'Camera not enrolled'
      : livePreviewState === 'reconnecting' ? 'Preview reconnecting'
        : livePreviewState === 'unavailable' ? 'Preview service unavailable'
          : livePreviewState === 'live' ? 'Preview only · gauges not analyzed' : 'Waiting for camera publisher'
    : fresh ? detected ? 'Detected needle positions' : 'Camera active · Gauges not detected'
      : frame ? 'Analysis stale · Values withheld' : analysisWaiting ? 'Camera live · Awaiting gauge analysis' : 'Awaiting camera';
  const conditionFreshness = service.previewOnly === true
    ? livePreviewState === 'not-enrolled' ? 'Camera enrollment required'
      : livePreviewState === 'reconnecting' ? 'Preview connection interrupted'
        : livePreviewState === 'unavailable' ? 'Preview service unavailable'
          : livePreviewState === 'live' ? 'RAM-only preview · no gauge analysis' : 'Waiting for Pi1 publisher'
    : frame ? <>{fresh ? 'Fresh' : 'Stale'} · {Math.max(0,Math.floor((now-Date.parse(frame.captured_at))/1000))}s since capture · <time dateTime={frame.captured_at}>{new Date(frame.captured_at).toLocaleTimeString()}</time></> : 'Freshness: Waiting for camera analysis';
  const save = async () => {
    if ((!showing && !(fast && liveAvailable)) || downloading.current) return;
    if (fast) {
      const selected = showing ? frame : liveFrame.current;
      const limit = showing ? 15000 : 2000;
      if (!selected || clock() - Date.parse(selected.captured_at) > limit || clock() < Date.parse(selected.captured_at) - 2000) return;
      downloading.current = true; setCapture(showing ? 'Preparing matched analysis image + readings…' : 'Preparing live image only; older gauge values are not copied…'); setCaptureFrame(selected); return;
    }
    downloading.current = true; setCapture('Preparing PNG…'); const selected = frame;
    try {
      const result = await captureSynchronizedFrame({ image: image.current, panel: panel.current, frame: selected, deviceId: device.deviceId, now: clock() });
      if (!mounted.current || current.current.frame?.camera_id !== selected.camera_id
        || current.current.frame?.bus_id !== selected.bus_id || document.hidden) return;
      downloadCameraEvidence(result); setCapture('PNG download requested.');
    } catch { setCapture('Capture unavailable; wait for a fresh matched preview.'); }
    finally { downloading.current = false; }
  };
  const finishCapture = useCallback(async (result, failure) => {
    const selected=captureFrame;
    setCaptureFrame(null);
    try{
      if(!mounted.current||document.hidden||!result||!selected)throw Error(failure||'capture-unavailable');
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
      <header className="camera-preview-heading"><div><h2 className="font-extrabold">{device.name}</h2><p className="text-xs text-slate-500">{device.deviceId} · {frame?.camera_id || 'Camera not verified'}</p></div>
        <span role="status" className="text-xs font-bold">{fast
          ? previewStatus
          : fresh ? 'Receiving captures' : frame ? 'Last known · stale' : 'Not receiving'}</span></header>
      {fast ? <FastLivePreview device={device} service={service} enabled clock={clock} decode={decode} latestFrameRef={liveFrame} onAvailability={setLiveAvailable} onStateChange={setLivePreviewState} /> : <div className="camera-preview-viewport relative aspect-video w-full overflow-hidden bg-[#111827]">
        {showing ? <img ref={image} src={`data:image/jpeg;base64,${frame.image.base64}`} alt={`${device.shortName} capture ${frame.capture_id}`}
          data-capture-id={frame.capture_id} className="h-full w-full object-contain" />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300"><VideoOff size={36} /><strong>No fresh matching preview</strong><span className="text-xs">Camera and gauge detection continue while waiting for a fresh frame.</span></div>}
      </div>}
      <div className="camera-preview-actions"><button type="button" disabled={!showing && !(fast && liveAvailable)} onClick={save} className="inline-flex items-center gap-2 rounded-xl bg-[#8e1f2f] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Download size={16} />Capture</button>
        <span className="camera-capture-mode">{showing ? 'Capture: image + readings' : 'Capture: live image only'}</span>
      </div>
      {capture && <p role="status" className="camera-capture-result" title={capture}>{capture}</p>}
    </section>
    <section ref={panel} data-device-id={device.deviceId} data-capture-id={frame?.capture_id} aria-label={`${device.shortName} vehicle condition`} className="camera-condition-panel">
      <header className="camera-condition-heading"><div><h2>Vehicle condition monitoring</h2><p className="camera-section-detail" title="Camera-derived estimates; physical accuracy unverified. Rejected readings remain blank.">{device.deviceId} · Camera estimates</p></div>
        <div className="camera-export-tools">{tripExportReady
          ? <><ConditionHistoryExport bus={bus} service={historyService} clock={clock} buttonLabel="Export CSV" />
            <span>Choose trip period</span></>
          : <><button type="button" onClick={exportCsv} disabled={!csvReady} title="Download the six readings from this fresh capture as a CSV file."><Download size={14} aria-hidden="true" />Export CSV</button>
            <span>{csvReady ? 'Ready to export' : 'No fresh readings'}</span></>}</div></header>
      <div className="camera-condition-body"><div role="status" className="camera-condition-source"><strong title={status}>{conditionStatus}</strong></div>
        <p role="status" className="camera-freshness">{conditionFreshness}</p>
        <div className="camera-condition-grid">{gauges.map((gauge) => <AnimatedCameraGauge compact key={gauge.gaugeKey} gauge={gauge} />)}</div>
      </div>
    </section>
    {captureFrame && <CaptureFrameSnapshot frame={captureFrame} deviceId={device.deviceId} clock={clock} onDone={finishCapture} />}
  </div>;
}
export default function SynchronizedCameraView({ service, clock = Date.now, decode, buses = [], historyService }) {
  const [startupDevice] = useState(() => launcherPreviewDevice());
  const [deviceId, setDeviceId] = useState(startupDevice || 'GPS-001');
  const selectDevice = id => { setDeviceId(id); };
  useEffect(() => {
    if (!startupDevice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('startup');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [startupDevice]);
  const device = LIVE_CAMERA_DEVICES.find((row) => row.deviceId === deviceId);
  const association = cameraDeviceAssociation(buses, deviceId);
  const historyBus = association.busId ? { id: association.busId, plateNumber: association.plate } : null;
  return <section aria-label="Live Camera View" className="live-camera-page"><div className="live-camera-toolbar"><div className="flex items-center gap-3"><MonitorPlay size={22} /><div><h2 className="font-extrabold">Camera & vehicle condition</h2><p className="text-xs text-slate-500">Live preview · Capture saves an image only when clicked.</p></div></div>
    <div className="live-camera-tabs" role="tablist" aria-label="Camera device">{LIVE_CAMERA_DEVICES.map((item) => <button type="button" role="tab" aria-selected={item.deviceId === deviceId}
      id={`camera-tab-${item.deviceId}`} aria-controls="camera-device-workspace" tabIndex={item.deviceId===deviceId?0:-1}
      key={item.deviceId} className="live-camera-tab" onClick={() => selectDevice(item.deviceId)}
      onKeyDown={(event)=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        event.preventDefault();const next=event.key==='Home'?LIVE_CAMERA_DEVICES[0]:event.key==='End'?LIVE_CAMERA_DEVICES[1]:LIVE_CAMERA_DEVICES.find(row=>row.deviceId!==deviceId);
        selectDevice(next.deviceId);document.getElementById(`camera-tab-${next.deviceId}`)?.focus();
      }}}><Camera size={17} /><span>{item.shortName}<small>{item.deviceId}</small></span></button>)}</div></div>
    <DeviceFrames key={deviceId} device={device} service={service} clock={clock} decode={decode}
      bus={historyBus} historyService={historyService} />
  </section>;
}
