import { useEffect, useState } from 'react';

const recent = (timestamp, now, limit) => {
  const at = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  return Number.isFinite(at) && now - at >= -2000 && now - at <= limit;
};

export function deviceTestRows(gpsRecords, previews, now) {
  return ['GPS-001', 'GPS-002'].map((device, index) => {
    const gps = gpsRecords.find(row => row?.deviceId === device);
    const preview = previews[device];
    const frame = preview?.frame;
    const cameraActive = preview?.state === 'live' && frame?.device_id === device
      && frame?.camera_id === `CAM-00${index + 1}` && recent(frame.captured_at, now, 15000);
    const gpsActive = gps?.online !== false && !gps?.sourceUnavailable
      && recent(gps?.gpsUpdatedAt ?? gps?.updatedAt, now, 10000);
    const activity = cameraActive || recent(gps?.deviceUpdatedAt, now, 30000);
    return { pi: `Pi${index + 1}`, device, camera: `CAM-00${index + 1}`,
      activity: activity ? 'ACTIVE' : 'NO RECENT DATA',
      gps: gpsActive ? 'FRESH' : gps ? 'STALE' : 'NO DATA',
      preview: cameraActive ? 'ACTIVE' : preview?.error ? 'UNAVAILABLE'
        : preview?.state === 'not-enrolled' ? 'NOT ENROLLED' : 'NO RECENT FRAME' };
  });
}

export default function DeviceHealthPanel({ enabled, gpsRecords = [], service, nowMs }) {
  const [previews, setPreviews] = useState({});
  useEffect(() => {
    if (!enabled || !service?.enabled || typeof service.readLive !== 'function') return undefined;
    let closed = false, timer;
    const abort = new AbortController();
    const poll = async () => {
      const rows = await Promise.all(['GPS-001', 'GPS-002'].map(async device => {
        try { return [device, await service.readLive(device, { preview: false, signal: abort.signal })]; }
        catch { return [device, { error: true }]; }
      }));
      if (closed) return;
      setPreviews(Object.fromEntries(rows));
      timer = setTimeout(poll, 5000); // Metadata only; never fetch/store an image.
    };
    void poll();
    return () => { closed = true; clearTimeout(timer); abort.abort(); };
  }, [enabled, service]);
  if (!enabled) return null;
  const rows = deviceTestRows(gpsRecords, previews, nowMs);
  const badge = value => <span className={`block text-[10px] font-extrabold ${['ACTIVE', 'FRESH'].includes(value) ? 'text-emerald-700' : 'text-slate-500'}`}>{value}</span>;
  return <div className="mt-3 rounded-xl border border-slate-200 p-2.5" aria-label="Temporary per-device health">
    <div className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Device test · temporary</div>
    <table className="w-full text-left text-[11px]"><thead><tr className="text-slate-500"><th>Pi activity</th><th>GPS</th><th>Camera</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.pi} className="border-t border-slate-100 align-top">
        <td className="py-2 pr-1 font-bold">{row.pi}{badge(row.activity)}</td>
        <td className="py-2 pr-1 font-bold">{row.device}{badge(row.gps)}</td>
        <td className="py-2 font-bold">{row.camera}{badge(row.preview)}</td>
      </tr>)}</tbody></table>
    <p className="text-[10px] text-slate-400">Received data activity, not a Pi power check.</p>
  </div>;
}
