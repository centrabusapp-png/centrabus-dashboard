import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel.js';
import { cameraCsvTable } from './cameraCsvFormat.js';

const OFFSET = 8 * 3600000;
export const CONDITION_HISTORY_MAX_CAPTURES = 20000;
const textId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const bounded = (value, min, max) => value === null || typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const philippineDateTime = ms => new Date(ms + OFFSET).toISOString().slice(0, 19);
export function defaultConditionPeriod(now = Date.now()) {
  const to = philippineDateTime(now);
  return { from: `${to.slice(0, 10)}T00:00:00`, to };
}
export function conditionPeriod(from, to) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) throw Error('invalid-period');
    const ms = Date.parse(`${value}+08:00`);
    if (!Number.isFinite(ms) || philippineDateTime(ms).slice(0, value.length) !== value) throw Error('invalid-period');
    return ms;
  };
  const start = parse(from), end = parse(to);
  if (start >= end || end - start > 31 * 86400000) throw Error('invalid-period');
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

function validateFrame(frame, { busId, from, to, snapshot }) {
  if (!frame || frame.bus_id !== busId || !['GPS-001', 'GPS-002'].includes(frame.device_id)
      || !textId(frame.camera_id) || !textId(frame.capture_id) || !textId(frame.processor_version)
      || !utc(frame.captured_at) || !utc(frame.received_at) || frame.calibration_verified !== false || frame.interpretation !== 'unverified'
      || Date.parse(frame.captured_at) < Date.parse(from) || Date.parse(frame.captured_at) >= Date.parse(to)
      || Date.parse(frame.received_at) > Date.parse(snapshot) || !Array.isArray(frame.readings) || frame.readings.length !== 6) throw Error('invalid-history-response');
  const seen = new Set();
  for (const reading of frame.readings) {
    const pressure = ['frontAir', 'rearAir'].includes(reading.gauge_key);
    if (!LIVE_GAUGE_KEYS.includes(reading.gauge_key) || seen.has(reading.gauge_key)
        || !['detected', 'uncertain', 'undetected'].includes(reading.quality)
        || reading.unit !== (pressure ? 'kg/cm2' : '%') || !bounded(reading.value, 0, pressure ? 1000 : 100)
        || !bounded(reading.angle_deg, -360, 360) || !bounded(reading.dial_percent, 0, 100)
        || reading.quality === 'detected' && reading.angle_deg === null
        || reading.quality !== 'detected' && [reading.value, reading.angle_deg, reading.dial_percent].some(value => value !== null)
        || reading.value === null && reading.dial_percent !== null) throw Error('invalid-history-response');
    seen.add(reading.gauge_key);
  }
  return frame;
}

// Historical captures are intentionally NOT subjected to the live 15s gate.
// Original observation times/quality stay intact; export time is a separate field.
export function buildConditionHistoryCsv({ frames, busId, busLabel, from, to, snapshot, includeDetails = false, now = Date.now() }) {
  if (!textId(busId) || !utc(from) || !utc(to) || !utc(snapshot) || Date.parse(from) >= Date.parse(to)
      || !Number.isFinite(now) || !Array.isArray(frames) || !frames.length || frames.length > CONDITION_HISTORY_MAX_CAPTURES) throw Error('invalid-history-response');
  const seen = new Set();
  const checked = frames.map(input => {
    const frame = validateFrame(input, { busId, from, to, snapshot });
    const key = JSON.stringify([frame.camera_id, frame.capture_id]);
    if (seen.has(key)) throw Error('duplicate-history-capture');
    seen.add(key);
    return frame;
  });
  checked.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at)
    || a.camera_id.localeCompare(b.camera_id) || a.capture_id.localeCompare(b.capture_id));
  const { csv } = cameraCsvTable({ frames: checked, busLabel, includeDetails, now });
  const label = String(busLabel || busId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'bus';
  return { csv, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), captures: frames.length, rows: frames.length,
    readingCount: frames.length * 6,
    filename: `centrabus-${label}-condition-${from.replace(/[:.]/g, '-')}-to-${to.replace(/[:.]/g, '-')}.csv` };
}

export function createConditionHistoryService({ config, development = process.env.NODE_ENV !== 'production', getSession, fetchImpl = (...args) => fetch(...args) }) {
  const enabled = config?.configured === true && (development || config.origin?.startsWith('https://'));
  return { enabled, async exportCsv({ busId, busLabel, from, to, signal, onProgress, includeDetails = false, now = Date.now() }) {
    if (!enabled || !textId(busId) || !utc(from) || !utc(to) || Date.parse(from) >= Date.parse(to)
        || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw Error('history-not-configured');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 120000);
    const frames = [], cursors = new Set(), captures = new Set();
    let cursor = null, snapshot = null;
    try {
      do {
        if (controller.signal.aborted) throw Error('history-cancelled');
        const params = new URLSearchParams({ from, to });
        if (cursor) params.set('cursor', cursor);
        if (snapshot) params.set('snapshot', snapshot);
        const page = await boundedHistoryPage(async requestSignal => {
          const session = await getSession();
          const token = session?.data?.session?.access_token;
          if (session?.error || !token || requestSignal.aborted) throw Error('history-sign-in-required');
          let response;
          try {
            response = await fetchImpl(`${development ? '' : config.origin}/api/camera-frames/buses/${encodeURIComponent(busId)}/history?${params}`, {
              headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
              cache: 'no-store', credentials: 'omit', redirect: 'error', signal: requestSignal,
            });
          } catch {
            if (requestSignal.aborted) throw Error('history-unavailable');
            throw Error('history-network-unavailable');
          }
          if (!response.ok) throw Error([401, 403].includes(response.status) ? 'history-sign-in-required'
            : response.status === 404 ? 'history-route-unavailable'
              : response.status === 429 ? 'history-rate-limited' : 'history-unavailable');
          if (!response.headers?.get('content-type')?.includes('application/json')) throw Error('history-unavailable');
          let text = '';
          if (response.body?.getReader) {
            const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0;
            try { for (;;) { const part = await reader.read(); if (part.done) break;
              bytes += part.value.byteLength; if (bytes > 2000000) throw Error('invalid-history-response');
              text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
            finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          } else { text = await response.text(); if (text.length > 2000000) throw Error('invalid-history-response'); }
          try { return JSON.parse(text); }
          catch { throw Error('invalid-history-response'); }
        }, controller.signal);
        if (page?.ok !== true || page.busId !== busId || page.from !== from || page.to !== to || !utc(page.snapshot)
            || snapshot && snapshot !== page.snapshot || !Array.isArray(page.frames) || page.frames.length > 500
            || page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(page.nextCursor))
            || page.nextCursor !== null && !page.frames.length) throw Error('invalid-history-response');
        snapshot = page.snapshot;
        for (const frame of page.frames) {
          validateFrame(frame, { busId, from, to, snapshot });
          const key = JSON.stringify([frame.camera_id, frame.capture_id]);
          if (captures.has(key)) throw Error('duplicate-history-capture');
          captures.add(key); frames.push(frame);
        }
        if (frames.length > CONDITION_HISTORY_MAX_CAPTURES || frames.length === CONDITION_HISTORY_MAX_CAPTURES && page.nextCursor) throw Error('history-too-large');
        onProgress?.(frames.length);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw Error('invalid-history-response');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (controller.signal.aborted) throw Error('history-cancelled');
      if (!frames.length) throw Error('history-empty');
      return buildConditionHistoryCsv({ frames, busId, busLabel, from, to, snapshot, includeDetails, now });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } };
}

async function boundedHistoryPage(work, signal) {
  const controller = new AbortController(); let reject;
  const stopped = new Promise((_, fail) => { reject = fail; });
  const abort = () => { controller.abort(); reject(Error('history-unavailable')); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 12000);
  try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), stopped]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function downloadConditionHistory({ blob, filename }) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  try { anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
