import { useEffect, useState } from 'react';
import { pendingPresenceService } from './devicePresenceService';

export default function DevicePresence({ authorized, service = pendingPresenceService, deviceId }) {
  const [data, setData] = useState({ snapshot: null, readAt: null, failed: false });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!authorized || service === pendingPresenceService) return undefined;
    let active = true, busy = false, controller;
    setData({ snapshot: null, readAt: null, failed: false });
    const poll = async () => {
      if (busy) return;
      busy = true; controller = new AbortController();
      try {
        const snapshot = await service.read({ signal: controller.signal });
        if (active) { setData({ snapshot, readAt: Date.now(), failed: false }); setNow(Date.now()); }
      } catch { if (active) setData((old) => ({ ...old, failed: true })); }
      finally { busy = false; }
    };
    void poll(); const interval = setInterval(poll, 15000);
    return () => { active = false; clearInterval(interval); controller?.abort(); };
  }, [authorized, service]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  if (!authorized) return null;
  const row = data.snapshot?.devices.find((item) => item.deviceId === deviceId);
  // Age relative to server time + elapsed local time, not browser clock offset.
  const initialAge = row?.lastSeenAt ? Date.parse(data.snapshot.serverTime) - Date.parse(row.lastSeenAt) : NaN;
  const age = initialAge + (now - data.readAt);
  const online = !data.failed && row?.reporting === true && Number.isFinite(age) && age >= 0 && age <= 45000;
  return <div aria-label="Pi setup check-in" className="mt-4 flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
    <div className="min-w-0"><p className="font-extrabold text-slate-800">{deviceId} setup connection</p><p className="mt-1 leading-relaxed text-slate-500">{service === pendingPresenceService ? 'Start CentraBus with start-local.cmd to enable local setup check-ins.'
      : data.failed ? 'Backend check-in status unavailable. No connection is assumed.'
      : online ? `Verified setup report · ${Math.floor(age / 1000)}s ago. This is not GPS freshness or proof of the same Wi-Fi SSID.`
      : 'Waiting for the Pi setup app to check in. Configure its laptop backend address once.'}</p></div>
    <span className={`shrink-0 rounded-full px-2.5 py-1 font-bold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-500'}`}>{online ? 'Setup online' : 'Not reporting'}</span>
  </div>;
}
