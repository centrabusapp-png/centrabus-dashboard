import { useEffect, useRef, useState } from 'react';
import { Camera, Download, MonitorPlay, Play, ShieldCheck, VideoOff } from 'lucide-react';
import { cameraFeedConfigured, disposeLiveCameraSession, LIVE_CAMERA_DEVICES, pendingLiveCameraService, validLiveCameraSession } from './liveCameraService';
import { cameraReadingsFeatureEnabled } from './cameraReadings';
import { pendingCameraReadingsService } from './cameraReadingsService';
import { cameraDeviceAssociation } from './liveCameraGaugeModel';
import LiveCameraGauges from './LiveCameraGauges';
import { canCaptureCameraEvidence, captureCameraEvidence, downloadCameraEvidence } from './cameraEvidence';
import './LiveCameraView.css';
import SynchronizedCameraView from './SynchronizedCameraView';

const labels = { unconfigured: 'Feed not configured', ready: 'Ready to connect', connecting: 'Connecting',
  connected: 'Waiting for video', playing: 'Receiving video', buffering: 'Video delayed', paused: 'Paused',
  stopped: 'Stopped', offline: 'Feed disconnected', failed: 'Connection failed' };

export function LiveCameraTile({ device, service = pendingLiveCameraService, timeoutMs = 8000, onCameraIdentity, gaugePanelRef }) {
  const configured = cameraFeedConfigured(service, device.deviceId);
  const [state, setState] = useState({ status: configured ? 'ready' : 'unconfigured', cameraId: null, lastActivity: null });
  const [now, setNow] = useState(Date.now);
  const video = useRef(null);
  const active = useRef(null);
  const pending = useRef(null);
  const generation = useRef(0);
  const attachedAt = useRef(null);
  const mediaCleanup = useRef(() => {});
  const captureBusy = useRef(false);
  const [capture, setCapture] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    onCameraIdentity?.(state.cameraId);
    return () => onCameraIdentity?.(null);
  }, [state.cameraId, onCameraIdentity]);

  const release = () => {
    generation.current += 1;
    captureBusy.current = false;
    pending.current?.abort(); pending.current = null;
    mediaCleanup.current(); mediaCleanup.current = () => {};
    if (video.current) video.current.srcObject = null;
    const session = active.current; active.current = null;
    attachedAt.current = null;
    if (session) disposeLiveCameraSession(session);
  };
  const finish = (status) => {
    release();
    setCapture({ status: 'idle', message: '' });
    setState({ status, cameraId: null, lastActivity: null });
  };

  useEffect(() => {
    setCapture({ status: 'idle', message: '' });
    setState({ status: configured ? 'ready' : 'unconfigured', cameraId: null, lastActivity: null });
    const hidden = () => { if (document.hidden && (active.current || pending.current)) finish('stopped'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); release(); };
    // Each adapter/device owns only its own session; never reuse the other tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, device.deviceId, configured]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const connect = async () => {
    if (!configured || pending.current || active.current) return;
    const own = ++generation.current;
    const controller = new AbortController(); pending.current = controller;
    let timeout;
    let cancel;
    let committed = false;
    setState({ status: 'connecting', cameraId: null, lastActivity: null });
    // Enforce a deadline even if a future adapter ignores AbortSignal. If it
    // resolves after cancellation/timeout, immediately dispose that late stream.
    const opening = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('cancelled');
      return service.open(device.deviceId, { signal: controller.signal });
    }).then((session) => {
      if (controller.signal.aborted || generation.current !== own) { disposeLiveCameraSession(session); throw new Error('cancelled'); }
      return session;
    });
    try {
      const session = await Promise.race([opening, new Promise((_, reject) => {
        cancel = () => reject(new Error('cancelled'));
        controller.signal.addEventListener('abort', cancel, { once: true });
        timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, Math.min(15000, Math.max(1, timeoutMs)));
      })]);
      if (!validLiveCameraSession(session, device.deviceId)) { disposeLiveCameraSession(session); throw new Error('invalid-session'); }
      if (controller.signal.aborted || generation.current !== own) { disposeLiveCameraSession(session); return; }
      active.current = session; committed = true;
      attachedAt.current = Date.now();
      const element = video.current;
      if (!element) throw new Error('video-unavailable');
      element.srcObject = session.stream;
      let callback = null;
      let previousTime = element.currentTime;
      const activity = () => {
        if (active.current !== session || element.paused) return;
        const at = Date.now(); setNow(at);
        setState({ status: 'playing', cameraId: session.cameraId, lastActivity: at });
      };
      const frame = () => {
        activity();
        if (active.current === session) callback = element.requestVideoFrameCallback(frame);
      };
      if (typeof element.requestVideoFrameCallback === 'function') callback = element.requestVideoFrameCallback(frame);
      // Fallback is actual playback-time progress, not merely an open socket.
      const progress = () => { if (element.currentTime > previousTime) activity(); previousTime = element.currentTime; };
      const ended = () => { if (active.current === session) finish('offline'); };
      const muted = () => { if (active.current === session) setState((current) => ({ ...current, status: 'buffering' })); };
      const track = session.stream.getVideoTracks()[0];
      track.addEventListener('ended', ended); track.addEventListener('mute', muted);
      element.addEventListener('timeupdate', progress);
      mediaCleanup.current = () => {
        if (callback !== null) element.cancelVideoFrameCallback?.(callback);
        element.removeEventListener('timeupdate', progress);
        track.removeEventListener('ended', ended); track.removeEventListener('mute', muted);
      };
      setState({ status: 'connected', cameraId: session.cameraId, lastActivity: null });
    } catch {
      if (generation.current === own) finish('failed');
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', cancel);
      if (pending.current === controller) pending.current = null;
      // An adopted stream is released on Stop/navigation, not after open().
      if (!committed) controller.abort();
    }
  };

  const connected = ['connected', 'playing', 'buffering', 'paused'].includes(state.status);
  const stalled = ['playing', 'connected'].includes(state.status) && now - (state.lastActivity ?? attachedAt.current) > 10000;
  const status = stalled ? 'buffering' : state.status;
  const receiving = status === 'playing';
  const captureOptions = (at) => ({ video: video.current, session: active.current,
    deviceId: device.deviceId, status, lastActivity: state.lastActivity, now: at, gaugePanel: gaugePanelRef?.current });
  const captureReady = canCaptureCameraEvidence(captureOptions(now));
  const saveEvidence = async () => {
    if (captureBusy.current || document.hidden) return;
    const own = generation.current;
    const session = active.current;
    captureBusy.current = true;
    setCapture({ status: 'busy', message: 'Preparing PNG…' });
    try {
      const evidence = await captureCameraEvidence(captureOptions(Date.now()));
      // Do not download an old device's frame after switching, Stop or auth loss.
      if (generation.current !== own || active.current !== session || document.hidden) return;
      downloadCameraEvidence(evidence);
      setCapture({ status: 'done', message: `PNG download requested · ${evidence.snapshotUtc}` });
    } catch {
      if (generation.current === own) setCapture({ status: 'error', message: 'Capture unavailable. Check that video is playing, then try again.' });
    } finally {
      if (generation.current === own) captureBusy.current = false;
    }
  };

  const previewOn = connected || state.status === 'connecting';
  return <section aria-label={`${device.shortName} camera`} className="camera-preview-panel min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#8E1F2F]/10 text-[#8E1F2F]"><Camera size={20} aria-hidden="true" /></span><div><p className="camera-section-eyebrow">Live camera preview</p><h2 className="text-base font-extrabold text-slate-900">{device.name}</h2><p className="mt-0.5 text-xs text-slate-500">{device.deviceId} · Dashboard camera</p></div></div>
      <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold ${receiving ? 'bg-emerald-50 text-emerald-700' : status === 'failed' || status === 'offline' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}><span className={`h-1.5 w-1.5 rounded-full ${receiving ? 'bg-emerald-500' : 'bg-current opacity-50'}`} />{labels[status]}</span>
    </div>
    <div className="relative aspect-video w-full overflow-hidden bg-[#111827]">
      <video ref={video} aria-label={`${device.shortName} live camera video`} autoPlay playsInline muted controls={connected}
        controlsList="nodownload noremoteplayback" disablePictureInPicture preload="none"
        className={`h-full w-full object-contain ${connected ? '' : 'invisible'}`}
        onPause={() => { if (active.current) setState((current) => ({ ...current, status: 'paused' })); }}
        onWaiting={() => { if (active.current) setState((current) => ({ ...current, status: 'buffering' })); }}
        onError={() => { if (active.current) finish('failed'); }} onEnded={() => { if (active.current) finish('offline'); }} />
      {!connected && <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center"><span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-slate-400"><VideoOff size={30} aria-hidden="true" /></span><p className="text-sm font-bold text-slate-200">{status === 'connecting' ? 'Connecting to camera…' : 'No video feed'}</p><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-400">{status === 'unconfigured' ? `A secure video source for ${device.shortName} has not been connected.` : status === 'failed' ? 'The feed could not be opened. Check camera access and the streaming connection.' : 'Start viewing when the authenticated camera source is available.'}</p></div>}
    </div>
    <div className="space-y-3 p-4 sm:p-5">
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-xs"><div className="min-w-0"><dt className="font-bold text-slate-500">Camera identity</dt><dd className="mt-1 break-all font-semibold text-slate-800">{state.cameraId || 'Not verified'}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-500">Last video activity</dt><dd className="mt-1 font-semibold text-slate-800">{state.lastActivity == null ? 'No frames received' : `${Math.max(0, Math.floor((now - state.lastActivity) / 1000))}s ago`}</dd></div></dl>
      <div className="camera-preview-controls"><p className="text-xs font-semibold text-slate-600">{previewOn ? 'Preview enabled' : 'Preview is off'}</p>
        <button type="button" role="switch" aria-checked={previewOn} aria-label={`${device.shortName} camera preview`}
          onClick={() => previewOn ? finish('stopped') : connect()} disabled={!configured} className="camera-preview-switch">
          {previewOn ? <VideoOff size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {state.status === 'connecting' ? 'Connecting…' : previewOn ? 'Preview on' : 'Preview off'}
          <span className="camera-preview-switch-track" aria-hidden="true"><span className="camera-preview-switch-thumb" /></span>
        </button></div>
      <div className="camera-evidence-controls">
        <button type="button" className="camera-evidence-button" onClick={saveEvidence}
          disabled={!captureReady || capture.status === 'busy'} aria-label={`Capture ${device.shortName} camera and gauges`}
          title="Download the camera preview and all six gauges together as PNG."><Download size={16} aria-hidden="true" />
          {capture.status === 'busy' ? 'Capturing…' : 'Capture'}</button>
      </div>
      {capture.message && <p role="status" className={`text-xs ${capture.status === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{capture.message}</p>}
    </div>
  </section>;
}

function LiveCameraWorkspace({ service, buses, gaugeService, calibration, gaugesEnabled, clock }) {
  const [deviceId, setDeviceId] = useState(LIVE_CAMERA_DEVICES[0].deviceId);
  const [cameraId, setCameraId] = useState(null);
  const gaugePanelRef = useRef(null);
  const device = LIVE_CAMERA_DEVICES.find((item) => item.deviceId === deviceId);
  const association = cameraDeviceAssociation(buses, deviceId);
  const select = (id) => { if (id !== deviceId) { setCameraId(null); setDeviceId(id); } };
  return <section aria-label="Live Camera View" className="min-w-0 space-y-4">
    <div className="live-camera-toolbar"><div className="flex min-w-0 items-center gap-3"><MonitorPlay className="shrink-0 text-[#8E1F2F]" size={22} aria-hidden="true" /><div><h2 className="text-sm font-extrabold text-slate-900">Camera & vehicle condition</h2><p className="mt-1 text-xs text-slate-500">Select a Pi to monitor its camera and six dashboard gauges.</p></div></div>
      <div className="live-camera-tabs" role="tablist" aria-label="Camera device">{LIVE_CAMERA_DEVICES.map((item) => <button key={item.deviceId}
        type="button" role="tab" id={`camera-tab-${item.deviceId}`} aria-selected={deviceId === item.deviceId}
        tabIndex={deviceId === item.deviceId ? 0 : -1}
        aria-controls="camera-device-workspace" className="live-camera-tab" onClick={() => select(item.deviceId)}
        onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? LIVE_CAMERA_DEVICES[0] : event.key === 'End'
            ? LIVE_CAMERA_DEVICES[1] : LIVE_CAMERA_DEVICES.find((entry) => entry.deviceId !== deviceId);
          select(next.deviceId); document.getElementById(`camera-tab-${next.deviceId}`)?.focus();
        } }}><Camera size={17} aria-hidden="true" /><span>{item.shortName}<small>{item.deviceId}</small></span></button>)}</div>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500"><ShieldCheck size={14} aria-hidden="true" /> Local snapshots · No video recording</span>
    </div>
    <div role="tabpanel" id="camera-device-workspace" aria-labelledby={`camera-tab-${deviceId}`} className="live-camera-workspace">
      <LiveCameraTile key={deviceId} device={device} service={service} onCameraIdentity={setCameraId} gaugePanelRef={gaugePanelRef} />
      <LiveCameraGauges key={`gauges:${deviceId}`} device={device} association={association} enabled={gaugesEnabled}
        service={gaugeService} calibration={calibration} expectedCameraId={cameraId} clock={clock} panelRef={gaugePanelRef} />
    </div>
  </section>;
}

export default function LiveCameraView({ authorized = false, service = pendingLiveCameraService, buses = [],
  gaugeService = pendingCameraReadingsService, calibration = null, gaugesEnabled = cameraReadingsFeatureEnabled(), clock = Date.now, frameService }) {
  if (!authorized) return <section aria-label="Live Camera View" className="rounded-[24px] border bg-white p-5"><p>Active administrator access is required to view cameras.</p></section>;
  if (frameService?.enabled === true) return <SynchronizedCameraView service={frameService} clock={clock} />;
  return <LiveCameraWorkspace service={service} buses={buses} gaugeService={gaugeService}
    calibration={calibration} gaugesEnabled={gaugesEnabled} clock={clock} />;
}
