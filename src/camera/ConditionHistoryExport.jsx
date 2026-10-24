import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { conditionPeriod, defaultConditionPeriod, downloadConditionHistory } from './conditionHistoryCsv';

const messages = {
  'history-empty': 'No saved readings for this bus and period. Try another time range.',
  'history-sign-in-required': 'Your session could not be authorized. Sign in again and retry.',
  'history-too-large': 'Too many readings for one file. Choose a shorter time range.',
  'history-route-unavailable': 'Saved-readings export is unavailable on this backend. Update and restart the launcher, then retry.',
  'history-rate-limited': 'Too many export requests. Wait a moment, then retry.',
  'history-unavailable': 'Saved readings could not be loaded. Check backend access and retry. No file was downloaded.',
  'invalid-history-response': 'The saved readings could not be verified. No file was downloaded.',
  'duplicate-history-capture': 'The saved readings could not be verified. No file was downloaded.',
  'invalid-period': 'Choose a valid From/To period of up to 31 days.',
};

function ExportDialog({ bus, service, onClose, onDownloaded, download, clock }) {
  const [period, setPeriod] = useState(() => defaultConditionPeriod(clock()));
  const [state, setState] = useState({ busy: false, count: 0, error: '' });
  const dialog = useRef(null), pending = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => { pending.current?.abort(); if (element.open && typeof element.close === 'function') element.close(); };
  }, []);
  const submit = async event => {
    event.preventDefault();
    if (pending.current) return;
    let range;
    try { range = conditionPeriod(period.from, period.to); }
    catch { setState({ busy: false, count: 0, error: messages['invalid-period'] }); return; }
    const controller = new AbortController(); pending.current = controller;
    setState({ busy: true, count: 0, error: '' });
    try {
      const result = await service.exportCsv({ busId: bus.id, busLabel: bus.plate || bus.plateNumber || bus.number || bus.id,
        ...range, now: clock(), signal: controller.signal,
        onProgress: count => { if (!controller.signal.aborted) setState({ busy: true, count, error: '' }); } });
      if (controller.signal.aborted) return;
      download(result); onDownloaded(`CSV downloaded · ${result.captures} captures`); onClose();
    } catch (error) {
      if (!controller.signal.aborted) setState({ busy: false, count: 0,
        error: messages[error.message] || 'Readings could not be exported. Check the backend connection and retry. No partial file was downloaded.' });
    } finally { if (pending.current === controller) pending.current = null; }
  };
  return <dialog ref={dialog} className="condition-export-dialog" aria-labelledby="condition-export-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit}>
      <header><div><h2 id="condition-export-title">Export trip readings</h2><p>{bus.plate || bus.plateNumber || bus.number || 'Selected bus'}</p></div>
        <button type="button" aria-label="Close CSV export" onClick={onClose}><X size={18} /></button></header>
      <p className="condition-export-note">Saved readings only · Philippine time (UTC+8)</p>
      <div className="condition-export-period">
        <label>From<input type="datetime-local" step="1" required value={period.from} disabled={state.busy}
          onChange={event => setPeriod(value => ({ ...value, from: event.target.value }))} /></label>
        <label>To<input type="datetime-local" step="1" required value={period.to} disabled={state.busy}
          onChange={event => setPeriod(value => ({ ...value, to: event.target.value }))} /></label>
      </div>
      <p className="condition-export-note">All six gauges, angles, detection status and original timestamps. Missing readings stay blank.</p>
      {state.error && <p role="alert" className="condition-export-error">{state.error}</p>}
      {state.busy && <p role="status">Loading {state.count.toLocaleString()} saved captures…</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={state.busy}><Download size={15} />{state.busy ? 'Preparing CSV…' : 'Download CSV'}</button></footer>
    </form>
  </dialog>;
}

export default function ConditionHistoryExport({ bus, service, download = downloadConditionHistory, clock = Date.now, buttonLabel = 'Download CSV' }) {
  const [open, setOpen] = useState(false), [notice, setNotice] = useState('');
  const enabled = Boolean(bus?.id && service?.enabled);
  return <>
    <button type="button" onClick={() => { setNotice(''); setOpen(true); }} disabled={!enabled}
      title={enabled ? 'Download saved readings for a trip period' : 'Connect the backend to export saved readings'}><Download size={14} />{buttonLabel}</button>
    {notice && <span role="status" className="condition-export-notice">{notice}</span>}
    {open && enabled && <ExportDialog bus={bus} service={service} download={download} clock={clock}
      onDownloaded={setNotice} onClose={() => setOpen(false)} />}
  </>;
}
