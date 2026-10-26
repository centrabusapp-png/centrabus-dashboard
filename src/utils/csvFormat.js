// CSV cannot set Excel cell formats. A PHT text suffix prevents automatic
// minute:second formatting that can hide the hour. Original UTC stays available
// in the optional technical report; no capture timestamp is rewritten.
export function philippineCsvTime(timestamp) {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return { date: '', time: '' };
  const local = new Date(value + 8 * 3600000).toISOString();
  const hour = Number(local.slice(11, 13));
  return { date: local.slice(0, 10),
    time: `${String(hour % 12 || 12).padStart(2, '0')}${local.slice(13, 19)} ${hour < 12 ? 'AM' : 'PM'} PHT` };
}

export function csvCell(value) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
