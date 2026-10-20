import { useEffect, useRef, useState } from 'react';
import { RefreshCcw, Wifi } from 'lucide-react';
const button = 'rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold disabled:opacity-40';
export default function RemoteWifiPanel({ authorized, deviceId, service }) {
  const [state, setState] = useState(null); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [selected, setSelected] = useState(null);
  const [priority, setPriority] = useState('50'); const [confirmed, setConfirmed] = useState(false);
  const [refresh, setRefresh] = useState(0); const [tick, setTick] = useState(0);
  const password = useRef(null); const lifetime = useRef(null); const received = useRef(0); const sending = useRef(false);
  const requested = useRef(null);
  const clear = () => { if (password.current) password.current.value = ''; };
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setState(null); setSelected(null); setConfirmed(false); clear(); setMessage(''); setBusy(false); sending.current = false; requested.current = null;
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { controller.abort(); clear(); document.removeEventListener('visibilitychange', hidden); };
  }, [authorized, deviceId, service]);
  useEffect(() => {
    if (!authorized || !service?.enabled) return undefined;
    let active = true; let timer; const controller = new AbortController();
    const poll = async () => {
      try { const value = await service.read(deviceId, { signal: controller.signal });
        if (active) { received.current = performance.now(); setState(value); } }
      catch { if (active) { setState(null); clear(); } }
      finally { if (active) timer = setTimeout(poll, 3000); }
    };
    poll(); return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [authorized, deviceId, service, refresh]);
  useEffect(() => { const timer = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!state?.online || performance.now() - received.current > (state.remainingMs ?? 15000)
      || !state.report.networks.some((row) => row.id === selected)) clear();
  }, [state, selected, tick]);
  useEffect(() => {
    const intent = requested.current, result = state?.report?.lastResult, task = state?.report?.task;
    if (!state?.online || !intent || result?.commandId !== intent.commandId) return;
    if (result.outcome === 'accepted') {
      if (task === 'awaiting_confirmation') setMessage('Pi reports a temporary connection. Verify it and choose Keep connection before rollback.');
      else if (task === 'rolled_back') { setMessage('Pi reports the original connection restored.'); requested.current = null; }
      else if (task === 'failed' || task === 'unknown') { setMessage('Pi could not verify this connection. Inspect status before retrying.'); requested.current = null; }
    } else if (result.outcome === 'applied') {
      setMessage(intent.operation === 'scan' ? 'Pi scan completed. Review the reported networks and profile availability.'
        : task === 'applied' ? 'Pi reports the connection kept. Saved credentials remain only on the Pi.'
          : task === 'rolled_back' ? 'Pi reports the original connection restored.' : 'Pi acknowledged the operation. Verify the current status.');
      requested.current = null;
    } else { setMessage(`Pi reported ${result.outcome}. No successful connection is assumed.`); requested.current = null; }
  }, [state]);
  if (!authorized) return null;
  const elapsed = performance.now() - received.current;
  const online = state?.deviceId === deviceId && state.online && elapsed <= (state.remainingMs ?? 15000);
  const report = online ? state.report : null;
  const scanFresh = online && elapsed < (state.scanRemainingMs ?? 0);
  const profilesFresh = scanFresh && report.profilesStatus === 'ready' && elapsed < (state.profilesRemainingMs ?? 0);
  const waiting = report?.task === 'awaiting_confirmation';
  const unavailable = busy || Boolean(state?.pendingCommandId) || ['connecting', 'authorizing', 'unknown'].includes(report?.task);
  const remaining = online ? Math.max(0, Math.floor(((state.trialRemainingMs || 0) - elapsed) / 1000)) : 0;
  const network = report?.networks.find((row) => row.id === selected);
  const profile = report?.savedProfiles.find((row) => row.profileId === selected);
  const choices = report ? [...report.networks].sort((a, b) => b.signal-a.signal || a.ssid.localeCompare(b.ssid)) : [];
  const target = profile || network;
  const blocked = !target || target.connected !== false || target.security === 'unsupported' || !report?.connectEnabled
    || report.wifiConnected !== true || !scanFresh || profile && (!profilesFresh || !profile.available);
  const act = async (operation, payload = {}) => {
    if (!online || sending.current || !lifetime.current || lifetime.current.signal.aborted) { clear(); return; }
    const controller = lifetime.current; sending.current = true; setBusy(true); setMessage('');
    try {
      const reply = await service.command(state, operation, payload, { signal: controller.signal });
      if (!controller.signal.aborted) {
        requested.current = reply?.commandId ? { commandId: reply.commandId, operation } : null;
        setMessage('Request queued. Waiting for the authenticated Pi result—not yet applied.'); setRefresh((n) => n + 1);
      }
    } catch { if (!controller.signal.aborted) setMessage('Request not confirmed. Refresh status; do not assume the network changed.'); }
    finally { clear(); if (!controller.signal.aborted) { setBusy(false); sending.current = false; setConfirmed(false); } }
  };
  return <section aria-label={`${deviceId} remote Wi-Fi`} className="space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-extrabold">Remote Pi Wi-Fi</h3>
      <p className="mt-1 text-xs text-slate-500">The selected Pi scans its own surroundings. This laptop does not scan for it.</p></div>
      <button className={button} onClick={() => setRefresh((n) => n + 1)}><RefreshCcw size={14} className="mr-2 inline" />Refresh status</button></div>
    <div role="status" className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{online ? `${deviceId} agent reporting` : `${deviceId} — Unknown / agent unavailable`}</strong>
      <p className="mt-1 text-xs text-slate-500">{online ? `Wi-Fi: ${report.wifiConnected === true ? 'Connected' : report.wifiConnected === false ? 'Disconnected' : 'Unknown'} · Internet manager report: ${report.internet} · Operation: ${report.task}`
        : 'Start a separately approved Pi agent session before scanning. Shared Wi-Fi or fresh GPS does not confirm this connection.'}</p>
      {online && !report.connectEnabled && <p className="mt-1 text-xs">Scan-only session. Connections require local Pi authorization and verified rollback.</p>}</div>
    {!online && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">No live Wi-Fi agent is verified. Start the reviewed agent on the selected Pi first; changing this laptop page cannot turn on the Pi radio remotely.</p>}
    <button className={button} disabled={!online || unavailable || waiting} onClick={() => act('scan')}><Wifi size={15} className="mr-2 inline" />Scan Pi networks</button>
    <p className="text-xs text-slate-500">Scan refreshes nearby networks and saved Pi profiles. Stronger signal is listed first; it does not prove Internet speed. Keep both Pi and laptop able to reach this local backend.</p>
    <div className="grid gap-3 lg:grid-cols-2"><div aria-label="Pi scan results" className="space-y-2">
      <h4 className="text-sm font-extrabold">Saved on this Pi</h4>
      {report?.savedProfiles.map((row) => <button key={row.profileId} className={`${button} block w-full text-left ${selected === row.profileId ? 'border-[#8E1F2F] bg-rose-50' : ''}`}
        aria-label={`Saved ${row.ssid}`} aria-pressed={selected === row.profileId} disabled={unavailable || waiting || !profilesFresh}
        onClick={() => { clear(); setSelected(row.profileId); setConfirmed(false); }}>
        {row.ssid}<span className="float-right text-xs">{row.signal === null ? 'Not seen' : `${row.signal}%`}</span>
        <small className="mt-1 block text-slate-500">{row.connected === true ? 'Currently connected' : row.available ? 'Available · Uses saved credentials' : 'Not visible in the last scan'} · Priority {row.priority}</small>
      </button>)}
      {online && !report.savedProfiles.length && <p className="text-xs text-slate-500">{report.profilesStatus === 'unavailable' ? 'Saved profiles could not be verified. Refresh the scan; no password or profile was read as a secret.' : report.profilesStatus === 'ready' ? 'No compatible saved Wi-Fi profiles reported.' : 'Scan to load the actual saved profiles from this Pi.'}</p>}
      {online && (!scanFresh || report.profilesStatus === 'ready' && !profilesFresh) && <p className="text-xs text-amber-700">Refresh the Pi scan before connecting. Cached results do not prove current availability.</p>}
      <h4 className="pt-3 text-sm font-extrabold">Nearby networks</h4>
      {choices.map((row) => <button key={row.id} className={`${button} block w-full text-left ${selected === row.id ? 'border-[#8E1F2F] bg-rose-50' : ''}`}
        aria-pressed={selected === row.id} disabled={unavailable || waiting || !scanFresh} onClick={() => {
          clear(); const saved = report.savedProfiles.filter((item) => item.ssid === row.ssid && item.security === row.security && item.available);
          if (profilesFresh && saved.length > 1) {
            setSelected(null); setMessage('More than one saved profile matches this network. Select the intended profile under Saved on this Pi.');
          } else setSelected(profilesFresh && saved.length === 1 ? saved[0].profileId : row.id);
          setConfirmed(false);
        }}>
        {row.ssid}<span className="float-right text-xs">{row.signal}%</span><small className="mt-1 block text-slate-500">{row.security}{row.connected ? ' · Currently connected' : ''}</small></button>)}
      {online && !report.networks.length && <p className="text-xs text-slate-500">No scan results reported yet. Click Scan Pi networks.</p>}</div>
      <form className="space-y-3 rounded-2xl border p-4" onSubmit={(event) => { event.preventDefault();
        if (!confirmed || blocked || unavailable || waiting) { clear(); return; }
        if (profile) { act('connect_saved', { profileId: profile.profileId, profileVersion: profile.profileVersion }); return; }
        const value = password.current?.value || ''; clear();
        act('connect', { networkId: network.id, priority: Number(priority), password: value });
      }}><h4 className="text-sm font-bold">{target?.ssid || 'Select a saved or scanned network'}</h4>
        {profile ? <p className="rounded-xl bg-slate-50 p-3 text-xs">Saved on {deviceId}. The Pi's network manager uses its stored credentials; you do not need to enter or view the password. Existing priority/settings are preserved.</p> : <><label className="block text-xs font-bold">Wi-Fi password<input ref={password} type="password" autoComplete="new-password" minLength={8} maxLength={63}
          disabled={!network || unavailable || waiting || !report?.connectEnabled} className="mt-1 block w-full rounded-xl border p-2" required /></label>
        <label className="block text-xs font-bold">Priority (0–100)<input type="number" min="0" max="100" required value={priority}
          onChange={(event) => setPriority(event.target.value)} disabled={unavailable || waiting} className="mt-1 block w-full rounded-xl border p-2" /></label></>}
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}
          disabled={!online || unavailable || waiting} />I approve a temporary switch on {deviceId}. Keep is required before the Pi rollback timer expires.</label>
        <button className={`${button} bg-[#8E1F2F] text-white`} disabled={blocked || !confirmed || unavailable || waiting}>Connect on Pi</button>
        <p className="text-xs text-slate-500">{profile ? 'This switches only the selected Pi. Keep confirms the connection; no Keep requests rollback.' : 'New password is encrypted for this Pi session. Connect starts a trial; Keep saves the network privately on the Pi—not in browser storage or the database.'}</p>
      </form></div>
    {waiting && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold">Awaiting confirmation · {remaining}s remaining</p>
      <p className="text-xs">This report arrived through the Pi's new connection. Verify it, then Keep. No confirmation triggers the Pi's local rollback guard.</p>
      <div className="flex gap-2"><button className={button} disabled={unavailable || remaining < 6} onClick={() => act('keep', { trialId: report.trialId })}>Keep connection</button>
        <button className={button} disabled={unavailable || remaining < 6} onClick={() => act('rollback', { trialId: report.trialId })}>Roll back</button></div></div>}
    {message && <p role="status" className="text-xs text-slate-600">{message}</p>}
    <p className="text-xs text-slate-500">{report?.lastResult ? `Last command: ${report.lastResult.outcome}. ` : ''}Wi-Fi management never starts or reconfigures GPS, cameras, senders or queues.</p>
    <span className="sr-only">Status age tick {tick}</span>
  </section>;
}
