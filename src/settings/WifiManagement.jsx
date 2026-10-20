import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Wifi, X } from 'lucide-react';
import { WIFI_DEVICES, pendingWifiService, pendingWifiState, publicWifiState, validateWifiPlan, wifiStatusPresentation } from './wifiManagementModel';

const inputStyle = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#8E1F2F]/30';
const secondaryButton = 'rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const securityLabel = (value) => value === 'wpa3-personal' ? 'WPA3-Personal' : 'WPA2-Personal';
const operationTitles = { add: 'Add Wi-Fi Network', edit: 'Edit Wi-Fi Network', priority: 'Change Network Priority', remove: 'Remove Wi-Fi Network' };

// Inside the existing active/admin AuthGate. This prop is UI gating only;
// future delivery must independently verify the bearer and CURRENT admin profile.
export default function WifiManagement({ authorized = false, service = pendingWifiService, deviceId: selectedDeviceId, embedded = false }) {
  const [ownDeviceId, setDeviceId] = useState(WIFI_DEVICES[0].id);
  const deviceId = selectedDeviceId ?? ownDeviceId;
  const [state, setState] = useState(pendingWifiState(deviceId));
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [change, setChange] = useState(null);
  const [ssid, setSsid] = useState('');
  const [security, setSecurity] = useState('wpa2-personal');
  const [priority, setPriority] = useState('50');
  const [statusError, setStatusError] = useState('');
  const [formError, setFormError] = useState('');
  const [now, setNow] = useState(Date.now);
  const password = useRef(null);
  const dialog = useRef(null);
  const opener = useRef(null);
  const wasOpen = useRef(false);
  const clearPassword = () => { if (password.current) password.current.value = ''; };
  const closeChange = () => { clearPassword(); setChange(null); setFormError(''); setSsid(''); };

  useEffect(() => {
    if (!authorized) return undefined;
    let current = true;
    const controller = new AbortController();
    let timeout;
    setLoading(true); setState(pendingWifiState(deviceId)); setStatusError('');
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000);
    });
    Promise.race([Promise.resolve().then(() => service.getState(deviceId, { signal: controller.signal })), deadline])
      .then((result) => { if (current) { setState(publicWifiState(result, deviceId)); setNow(Date.now()); } })
      .catch(() => { if (current) setStatusError('Wi-Fi management status is unavailable. No device changes were sent.'); })
      .finally(() => { clearTimeout(timeout); if (current) setLoading(false); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [authorized, deviceId, service, refresh]);

  useEffect(() => {
    // Capture while mounted, so unmount/auth loss also erases the DOM field.
    const input = password.current;
    return () => { if (input) input.value = ''; };
  }, [authorized, change?.operation, change?.step]);

  useEffect(() => {
    const remaining = Date.parse(state.reportedAt) + 90_001 - Date.now();
    if (state.integration !== 'ready' || !Number.isFinite(remaining) || remaining <= 0 || remaining > 92_001) return undefined;
    const timeout = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timeout);
  }, [state]);

  useEffect(() => { if (!authorized) closeChange(); }, [authorized]);
  useEffect(() => { closeChange(); }, [deviceId]);
  useEffect(() => {
    if (change && authorized) {
      wasOpen.current = true;
      dialog.current?.querySelector('input, button')?.focus();
    } else if (wasOpen.current) {
      // Restore only AFTER React removes inert from the background.
      wasOpen.current = false;
      opener.current?.focus();
    }
  }, [change, authorized]);

  const openChange = (operation, event, profile = null) => {
    clearPassword(); opener.current = event.currentTarget; setFormError('');
    setSsid(profile?.ssid || ''); setSecurity(profile?.security || 'wpa2-personal'); setPriority(String(profile?.priority ?? 50));
    setChange({ operation, deviceId, original: profile, step: operation === 'remove' ? 'review' : 'edit',
      draft: operation === 'remove' ? profile : null });
  };
  const prepareReview = (event) => {
    event.preventDefault();
    if (!change || !authorized || change.deviceId !== deviceId) return;
    const draft = { deviceId, ssid, security, priority: priority === '' ? NaN : Number(priority) };
    let validation;
    try { validation = validateWifiPlan({ ...draft, password: password.current?.value || '' }); }
    catch { validation = 'This browser could not validate the network change.'; }
    finally { clearPassword(); } // Secrets never enter state, confirmation or an adapter.
    setFormError(validation);
    if (!validation) setChange({ ...change, step: 'review', draft });
  };
  const trapDialogKeys = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeChange(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  if (!authorized) return <section className="rounded-[24px] border bg-white p-5" aria-label="Wi-Fi Management"><p>Administrator access is required to manage Wi-Fi.</p></section>;
  const currentState = state?.deviceId === deviceId ? state : pendingWifiState(deviceId);
  const status = wifiStatusPresentation(currentState, now);
  const profiles = currentState.profiles;

  return (
    <section className={embedded ? 'min-w-0 bg-white p-4 sm:p-5' : 'min-w-0 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5'} aria-labelledby="wifi-management-title">
      <div inert={change ? true : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#8E1F2F]/10 text-[#8E1F2F]"><Wifi size={20} aria-hidden="true" /></span>
            <div><h2 id="wifi-management-title" className="text-[15px] font-extrabold text-slate-900">Wi-Fi Management</h2><p className="mt-1 text-sm text-slate-500">Trusted networks for each GPS device.</p></div>
          </div>
          <button type="button" className={secondaryButton} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? 'Checking…' : 'Refresh status'}</button>
        </div>
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Device changes are disabled until secure integration and local rollback are verified. Dialogs preview changes only; nothing is saved or sent.</p>
        {!embedded && <div className="mt-4 min-w-0 sm:max-w-sm">
          <label className="block text-xs font-bold text-slate-600" htmlFor="wifi-device">GPS device</label>
          <select id="wifi-device" className={inputStyle + ' mt-1.5'} value={deviceId} onChange={(event) => { closeChange(); setDeviceId(event.target.value); }}>{WIFI_DEVICES.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select>
        </div>}
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3.5 text-xs lg:grid-cols-4">
          {[['Wi-Fi', status.wifi], ['Internet', status.internet], ['Management', loading ? 'Checking…' : status.management], ['Last configuration', status.configuration]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-800">{value}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-slate-500">Only authenticated device reports can confirm connectivity or configuration. GPS activity is not Wi-Fi status.</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="min-w-0 flex-1"><h3 className="text-sm font-extrabold text-slate-800">Nearby Wi-Fi networks</h3><p id="wifi-scan-help" className="mt-1 text-xs leading-relaxed text-slate-500">Scanning must run on {deviceId}, not this browser. Secure Pi scanning is not connected yet.</p></div>
          <button type="button" disabled aria-describedby="wifi-scan-help" className={secondaryButton + ' cursor-not-allowed'}>Scan networks</button>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-extrabold text-slate-800">Saved networks</h3><button type="button" onClick={(event) => openChange('add', event)} className="w-full rounded-xl bg-[#8E1F2F] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#B22B34] sm:w-auto">Add Wi-Fi Network</button></div>
          <p className="mt-2 text-xs text-slate-500">Last reported device profiles · higher priority is preferred. Existing passwords are never displayed.</p>
          {Array.isArray(profiles) ? profiles.length ? <ul className="mt-3 space-y-2">{profiles.map((profile, index) => <li key={profile.ssid + '-' + index} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
            <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-all text-sm font-bold text-slate-800">{profile.ssid}</p><p className="mt-1 text-xs text-slate-500">{securityLabel(profile.security)} · Priority {profile.priority}</p></div>
            <div className="flex flex-wrap gap-2">{[['edit', 'Edit'], ['priority', 'Priority'], ['remove', 'Remove']].map(([operation, label]) => <button key={operation} type="button" aria-label={label + ' network ' + profile.ssid} title="Open a review only; device actions are disabled" className={secondaryButton} onClick={(event) => openChange(operation, event, profile)}>{label}</button>)}</div>
          </li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Device reported no managed networks.</p> : <p className="mt-3 text-sm text-slate-500">Not available until the secure device agent is connected.</p>}
        </div>
        {statusError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{statusError}</p>}
      </div>
      {change && <div className="fixed inset-0 z-[3000] grid place-items-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) closeChange(); }}>
        <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="wifi-change-title" onKeyDown={trapDialogKeys} className="max-h-[90dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-5">
          <div className="flex items-start justify-between gap-3"><h3 id="wifi-change-title" className="text-lg font-extrabold text-slate-900">{operationTitles[change.operation]}</h3><button type="button" aria-label="Close network dialog" onClick={closeChange} className="shrink-0 rounded-lg p-1.5 text-slate-500"><X size={20} /></button></div>
          <p className="mt-2 text-sm text-slate-500">{change.deviceId} · Preview only</p>
          {change.step === 'edit' ? <form className="mt-4 space-y-3" onSubmit={prepareReview} autoComplete="off" noValidate>
            <div><label htmlFor="wifi-ssid" className="block text-xs font-bold text-slate-600">Network SSID</label><input id="wifi-ssid" className={inputStyle + ' mt-1.5'} value={ssid} readOnly={change.operation === 'priority'} onChange={(event) => setSsid(event.target.value)} autoComplete="off" spellCheck={false} aria-describedby="wifi-ssid-help" /><p id="wifi-ssid-help" className="mt-1 text-xs text-slate-500">Exact name, including spaces · maximum 32 UTF-8 bytes.</p></div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <div><label htmlFor="wifi-security" className="block text-xs font-bold text-slate-600">Security</label><select id="wifi-security" className={inputStyle + ' mt-1.5'} disabled={change.operation === 'priority'} value={security} onChange={(event) => { clearPassword(); setSecurity(event.target.value); }}><option value="wpa2-personal">WPA2-Personal</option><option value="wpa3-personal">WPA3-Personal</option></select></div>
              <div><label htmlFor="wifi-priority" className="block text-xs font-bold text-slate-600">Priority (0–100)</label><input id="wifi-priority" type="number" min="0" max="100" step="1" className={inputStyle + ' mt-1.5'} value={priority} onChange={(event) => setPriority(event.target.value)} /></div>
            </div>
            {change.operation !== 'priority' && <div><label htmlFor="wifi-password" className="block text-xs font-bold text-slate-600">Wi-Fi password</label><input ref={password} id="wifi-password" type="password" className={inputStyle + ' mt-1.5'} maxLength={64} autoComplete="new-password" aria-describedby="wifi-password-help" /><p id="wifi-password-help" className="mt-1 text-xs text-slate-500">Do not enter a production password. Optional in this preview; cleared on review or close, never saved or sent. Existing passwords cannot be viewed.</p></div>}
            {formError && <p role="alert" className="text-sm font-semibold text-red-700">{formError}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-2"><button type="button" className={secondaryButton} onClick={closeChange}>Cancel</button><button type="submit" className="rounded-xl bg-[#8E1F2F] px-4 py-2 text-sm font-bold text-white">Review change</button></div>
          </form> : <>
            <h4 className="mt-4 text-sm font-bold text-slate-800">{change.operation === 'remove' ? 'Confirm network removal' : 'Review network change'}</h4>
            <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-bold text-slate-500">SSID</dt><dd className="whitespace-pre-wrap break-all">{change.draft.ssid}</dd></div><div><dt className="font-bold text-slate-500">Security</dt><dd>{securityLabel(change.draft.security)}</dd></div><div><dt className="font-bold text-slate-500">Priority</dt><dd>{change.draft.priority}</dd></div></dl>
            <p className="mt-4 flex gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><ShieldCheck className="shrink-0" size={18} />{change.operation === 'remove' ? 'The known-good fallback must be verified before removal. Never remove the last working network remotely.' : 'Password cleared. This review contains non-secret metadata only.'}</p>
            <p className="mt-3 text-xs text-slate-500">Secure agent, backend authorization/delivery, authenticated status verification and device-local rollback are not connected. No change can be applied.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={secondaryButton} onClick={closeChange}>Cancel</button><button type="button" disabled title="Secure device integration is not enabled" className={secondaryButton + ' cursor-not-allowed'}>{change.operation === 'remove' ? 'Remove from device' : change.operation === 'priority' ? 'Update device priority' : 'Apply to device'}</button></div>
          </>}
        </div>
      </div>}
    </section>
  );
}
