import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Download, X } from 'lucide-react';
import { conditionPeriod, defaultConditionPeriod, downloadConditionHistory } from './conditionHistoryCsv';

const messages = {
  'history-empty': 'No saved readings for this bus and period. Try another time range.',
  'history-sign-in-required': 'Your session could not be authorized. Sign in again and retry.',
  'history-too-large': 'Too many readings for one file. Choose a shorter time range.',
  'history-route-unavailable': 'Saved-readings export is unavailable on this backend. Update and restart the launcher, then retry.',
  'history-rate-limited': 'Too many export requests. Wait a moment, then retry.',
  'history-unavailable': 'Saved readings could not be loaded. Check backend access and retry. No file was downloaded.',
  'history-network-unavailable': 'Could not reach saved readings. Check the connection and retry. No file was downloaded.',
  'invalid-history-response': 'The saved readings could not be verified. No file was downloaded.',
  'duplicate-history-capture': 'The saved readings could not be verified. No file was downloaded.',
  'invalid-period': 'Choose a valid From/To period of up to 31 days.',
};

function ExportDialog({ bus, service, onClose, onDownloaded, download, clock }) {
  const [period, setPeriod] = useState(() => defaultConditionPeriod(clock()));
  const [includeDetails, setIncludeDetails] = useState(false);
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
        ...range, includeDetails, now: clock(), signal: controller.signal,
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
      <header><div><h2 id="condition-export-title">Choose date range</h2><p>{bus.plate || bus.plateNumber || bus.number || 'Selected bus'}</p></div>
        <button type="button" aria-label="Close CSV export" onClick={onClose}><X size={18} /></button></header>
      <p className="condition-export-note">Saved readings only · Philippine time (UTC+8)</p>
      <div className="condition-export-period">
        <label>From<input type="datetime-local" step="1" required value={period.from} disabled={state.busy}
          onChange={event => setPeriod(value => ({ ...value, from: event.target.value }))} /></label>
        <label>To<input type="datetime-local" step="1" required value={period.to} disabled={state.busy}
          onChange={event => setPeriod(value => ({ ...value, to: event.target.value }))} /></label>
      </div>
      <p className="condition-export-note">One row per capture, with all six gauges side by side. Units are in the column headers. Missing readings stay blank.</p>
      <label className="condition-export-details"><input type="checkbox" checked={includeDetails} disabled={state.busy}
        onChange={event => setIncludeDetails(event.target.checked)} />Include technical details (IDs, angles and UTC timestamps)</label>
      {state.error && <p role="alert" className="condition-export-error">{state.error}</p>}
      {state.busy && <p role="status">Loading {state.count.toLocaleString()} saved captures…</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={state.busy}><Download size={15} />{state.busy ? 'Preparing CSV…' : 'Download CSV'}</button></footer>
    </form>
  </dialog>;
}

export default function ConditionHistoryExport({ bus, service, download = downloadConditionHistory, clock = Date.now, buttonLabel = "Today's CSV" }) {
  const [open, setOpen] = useState(false), [notice, setNotice] = useState('');
  const [quick, setQuick] = useState({ busy: false, count: 0, error: '' });
  const pending = useRef(null);
  const enabled = Boolean(bus?.id && service?.enabled);
  useEffect(() => () => pending.current?.abort(), []);
  const downloadToday = async () => {
    if (!enabled || pending.current) return;
    const now = clock();
    const period = defaultConditionPeriod(now);
    let range;
    try { range = conditionPeriod(period.from, period.to); }
    catch { setQuick({ busy: false, count: 0, error: messages['invalid-period'] }); return; }
    const controller = new AbortController(); pending.current = controller;
    setNotice(''); setQuick({ busy: true, count: 0, error: '' });
    try {
      const result = await service.exportCsv({
        busId: bus.id,
        busLabel: bus.plate || bus.plateNumber || bus.number || bus.id,
        ...range,
        includeDetails: false,
        now,
        signal: controller.signal,
        onProgress: count => { if (!controller.signal.aborted) setQuick({ busy: true, count, error: '' }); },
      });
      if (controller.signal.aborted) return;
      download(result); setNotice(`CSV downloaded · ${result.captures} captures`);
      setQuick({ busy: false, count: 0, error: '' });
    } catch (error) {
      if (!controller.signal.aborted) setQuick({ busy: false, count: 0,
        error: messages[error.message] || 'Readings could not be exported. Check the backend connection and retry. No partial file was downloaded.' });
    } finally { if (pending.current === controller) pending.current = null; }
  };
  return <>
    <span className="condition-export-actions">
      <button type="button" onClick={downloadToday} disabled={!enabled || quick.busy}
        title={enabled ? "Download today's saved readings · Philippine time (UTC+8)" : 'Connect the backend to export saved readings'}>
        <Download size={14} />{quick.busy ? 'Preparing CSV…' : buttonLabel}
      </button>
      <button type="button" className="condition-export-secondary" onClick={() => { setNotice(''); setQuick({ busy: false, count: 0, error: '' }); setOpen(true); }}
        disabled={!enabled || quick.busy} title="Choose another date or time range"><CalendarDays size={13} />Other dates</button>
    </span>
    {notice && <span role="status" className="condition-export-notice">{notice}</span>}
    {quick.busy && <span role="status" className="condition-export-notice">Loading {quick.count.toLocaleString()} saved captures…</span>}
    {quick.error && <span role="alert" className="condition-export-error-inline">{quick.error}</span>}
    {open && enabled && <ExportDialog bus={bus} service={service} download={download} clock={clock}
      onDownloaded={setNotice} onClose={() => setOpen(false)} />}
  </>;
}
