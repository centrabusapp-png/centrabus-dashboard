import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Globe, Link2, Monitor, Radio, RefreshCcw, ShieldCheck, Wifi } from 'lucide-react';
import { BACKEND_CONFIG } from '../config/backendConfig';
import WifiManagement from './WifiManagement';
import { WIFI_DEVICES, pendingWifiService } from './wifiManagementModel';
import { deviceGpsSummary, setupAgeLabel } from './deviceSetupModel';
import { checkSetupBackend } from './setupConnectionService';
import DevicePresence from './DevicePresence';
import { pendingPresenceService } from './devicePresenceService';
import RemoteWifiPanel from './RemoteWifiPanel';
import { pendingRemoteWifiService } from './remoteWifiService';

const tabs = [{ id: 'network', label: 'Wi-Fi & Internet', icon: Wifi },
  { id: 'checks', label: 'Connection checks', icon: Link2 }, { id: 'gps', label: 'GPS status', icon: Radio }];
const buttonStyle = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

function CheckRow({ icon: Icon, title, value, detail, good = false }) {
  return <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
    <span className={`mt-0.5 rounded-lg p-2 ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><Icon size={18} aria-hidden="true" /></span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h4 className="text-sm font-bold text-slate-800">{title}</h4><span className={`text-xs font-bold ${good ? 'text-emerald-700' : 'text-slate-600'}`}>{value}</span></div><p className="mt-1 break-words text-xs leading-relaxed text-slate-500">{detail}</p></div>
  </div>;
}

export default function DeviceSetup({ authorized = false, wifiService = pendingWifiService, gpsByBusId = {},
  busesStatus, gpsRealtime, backendPoll, nowMs, config = BACKEND_CONFIG, checkBackend = checkSetupBackend, presenceService = pendingPresenceService,
  remoteWifiService = pendingRemoteWifiService }) {
  const [deviceId, setDeviceId] = useState('GPS-001');
  const [tab, setTab] = useState('network');
  const [clock, setClock] = useState(Date.now);
  const [check, setCheck] = useState({ status: 'idle' });
  const activeCheck = useRef(null);
  const generation = useRef(0);
  const tabButtons = useRef([]);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    setCheck({ status: 'idle' });
    activeCheck.current = null;
    return () => { generation.current += 1; activeCheck.current?.abort(); };
  }, [authorized]);

  const runCheck = async () => {
    if (!authorized || activeCheck.current) return;
    const controller = new AbortController();
    const ownGeneration = ++generation.current;
    activeCheck.current = controller;
    setCheck({ status: 'checking' });
    try {
      const result = await checkBackend({ config, signal: controller.signal });
      if (!controller.signal.aborted && ownGeneration === generation.current) setCheck({ status: 'success', checkedAt: result.checkedAt });
    } catch {
      if (!controller.signal.aborted && ownGeneration === generation.current) setCheck({ status: 'failed' });
    } finally { if (activeCheck.current === controller) activeCheck.current = null; }
  };
  const chooseTabWithKey = (event, index) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
    if (next !== null) { event.preventDefault(); setTab(tabs[next].id); tabButtons.current[next]?.focus(); }
  };

  if (!authorized) return <section aria-label="Device Setup" className="rounded-[24px] border bg-white p-5">Administrator access is required for Device Setup.</section>;
  const now = nowMs ?? clock;
  const gps = deviceGpsSummary(deviceId, gpsByBusId, now);
  const checkedAge = (clock - check.checkedAt) / 1000;
  const checkedRecently = check.status === 'success' && checkedAge >= -2 && checkedAge <= 15;
  const pollAge = (now - backendPoll?.lastSuccessAt) / 1000;
  const pollRecently = Number.isFinite(backendPoll?.lastSuccessAt) && pollAge >= -2 && pollAge <= 15 && !backendPoll?.consecutiveFailures;
  const reachable = check.status === 'failed' ? false : checkedRecently || pollRecently;
  const apiLabel = check.status === 'checking' ? 'Checking…' : !config.configured ? 'Not configured'
    : check.status === 'failed' ? 'Check failed' : reachable ? 'Reachable' : 'Not verified';

  return <section aria-labelledby="device-setup-title" className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#8E1F2F] text-white"><Monitor size={22} aria-hidden="true" /></span><div><h2 id="device-setup-title" className="text-lg font-extrabold text-slate-900">Device Setup</h2><p className="mt-1 text-sm text-slate-500">Choose a Raspberry Pi, then manage its connection in one place.</p></div></div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"><ShieldCheck size={14} aria-hidden="true" /> Administrator only</span>
      </div>
      <div aria-label="Choose a device" className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
        {WIFI_DEVICES.map((device, index) => <button key={device.id} type="button" aria-label={`Configure Pi${index + 1} ${device.id}`} aria-pressed={deviceId === device.id}
          onClick={() => setDeviceId(device.id)} className={`flex min-w-0 items-center gap-3 rounded-2xl border-2 p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8E1F2F]/40 ${deviceId === device.id ? 'border-[#8E1F2F] bg-[#8E1F2F]/5' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${deviceId === device.id ? 'bg-[#8E1F2F] text-white' : 'bg-white text-slate-500'}`}><Monitor size={21} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-900">Raspberry Pi {index + 1}</span><span className="block text-xs text-slate-500">{device.id} · Configured identity</span></span>
          {deviceId === device.id && <CheckCircle2 className="shrink-0 text-[#8E1F2F]" size={18} aria-hidden="true" />}
        </button>)}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">These are configured devices, not a Wi-Fi scan. Real network discovery and connection require an enrolled, authenticated Pi agent.</p>
      {!remoteWifiService.enabled && <DevicePresence authorized={authorized} service={presenceService} deviceId={deviceId} />}
    </div>
    <div role="tablist" aria-label="Device setup sections" className="grid grid-cols-3 gap-1 border-b border-slate-100 px-2 pt-2 sm:px-5">
      {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} ref={(element) => { tabButtons.current[index] = element; }} id={`setup-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`setup-panel-${id}`} tabIndex={tab === id ? 0 : -1}
        onKeyDown={(event) => chooseTabWithKey(event, index)} onClick={() => setTab(id)} className={`flex min-w-0 flex-wrap items-center justify-center gap-1.5 border-b-2 px-1 py-3 text-xs font-bold sm:text-sm ${tab === id ? 'border-[#8E1F2F] text-[#8E1F2F]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Icon size={16} aria-hidden="true" />{label}</button>)}
    </div>
    {tabs.map(({ id }) => <div key={id} id={`setup-panel-${id}`} role="tabpanel" aria-labelledby={`setup-tab-${id}`} hidden={tab !== id} tabIndex={0}>
      {id === 'network' && tab === id && (remoteWifiService.enabled
        ? <RemoteWifiPanel key={deviceId} authorized={authorized} service={remoteWifiService} deviceId={deviceId} />
        : <WifiManagement authorized={authorized} service={wifiService} deviceId={deviceId} embedded />)}
      {id === 'checks' && <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-extrabold text-slate-900">Connection checks</h3><p className="mt-1 text-xs text-slate-500">Browser and server checks are separate from {deviceId}’s Internet connection.</p></div><button type="button" onClick={runCheck} disabled={!config.configured || check.status === 'checking'} className={buttonStyle}><RefreshCcw size={15} aria-hidden="true" />Check backend</button></div>
        <div className="grid gap-3 lg:grid-cols-2">
          <CheckRow icon={Globe} title="Dashboard → backend" value={apiLabel} good={reachable} detail={config.origin ? `${config.origin} · Read-only health check; does not verify database writes or Pi reachability.` : 'Configure the public backend address for this dashboard build.'} />
          <CheckRow icon={Activity} title="Fleet data" value={busesStatus === 'ready' ? 'Loaded' : busesStatus === 'error' ? 'Unavailable' : 'Not loaded'} detail="Existing dashboard data only. This is not a new database connectivity test." />
          <CheckRow icon={Link2} title="GPS Realtime channel" value={gpsRealtime?.channelStatus === 'SUBSCRIBED' ? 'Subscribed' : 'Not verified'} detail="Uses the existing GPS subscription. A subscribed channel does not prove this Pi is sending fresh fixes." />
          <CheckRow icon={Wifi} title={`${deviceId} Internet`} value="See device report" detail="Use Wi-Fi & Internet for authenticated device reports. A reachable backend or fresh GPS is not proof of the Pi’s Wi-Fi status." />
        </div>
        <p role="status" className="text-xs leading-relaxed text-slate-600">{check.status === 'failed' ? 'Backend check failed. Check the address, running server and browser access. No device changes were sent.' : check.status === 'checking' ? 'Checking the configured backend without sending credentials…' : 'No LAN scan, device command or network change is performed by these checks.'}</p>
      </div>}
      {id === 'gps' && <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-extrabold text-slate-900">{deviceId} GPS status</h3><p className="mt-1 text-xs text-slate-500">Read-only view of the dashboard’s existing position data.</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${gps.recent ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{gps.label}</span></div>
        <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-xs sm:grid-cols-3">
          {[['Associated bus', gps.busId || 'Not verified'], ['Capture age', setupAgeLabel(gps.ageSeconds)], ['Quality at capture', gps.quality || 'Unknown'], ['Satellites at capture', gps.satellites ?? 'Unknown'], ['Accuracy at capture', gps.accuracy == null ? 'Unknown' : `${gps.accuracy} m`]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-800">{value}</dd></div>)}
          <div className="col-span-2 min-w-0 sm:col-span-3"><dt className="font-bold text-slate-500">Original GPS capture (UTC)</dt><dd className="mt-1 break-all font-semibold text-slate-800">{gps.capturedAt || 'Not available'}</dd></div>
        </dl>
        <p className="text-xs leading-relaxed text-slate-500">{gps.detail} Recent means a capture within 10 seconds; it is not physical receiver validation.</p>
        <p className="rounded-xl border border-slate-200 p-3 text-xs leading-relaxed text-slate-600">This screen never starts, stops or reconfigures GPS services. Existing GPS monitoring and offline queues are unchanged.</p>
      </div>}
    </div>)}
  </section>;
}
