export const pendingPresenceService = Object.freeze({ read: async () => null });
const DEVICES = ['GPS-001', 'GPS-002'];
const INTERNET = ['full', 'limited', 'portal', 'none', 'unknown'];
const utc = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function publicPresence(body) {
  if (body?.ok !== true || body.scope !== 'setup-presence-only' || !Array.isArray(body.devices) || body.devices.length !== 2
      || !utc(body.serverTime)) throw new Error('invalid-presence');
  const ids = new Set();
  const devices = body.devices.map((row) => {
    if (!DEVICES.includes(row?.deviceId) || ids.has(row.deviceId) || typeof row.reporting !== 'boolean'
        || ![true, false, null].includes(row.wifiConnected) || !INTERNET.includes(row.internet)
        || row.lastSeenAt !== null && !utc(row.lastSeenAt)) throw new Error('invalid-presence');
    ids.add(row.deviceId);
    return { deviceId: row.deviceId, reporting: row.reporting, lastSeenAt: row.lastSeenAt,
      wifiConnected: row.wifiConnected, internet: row.internet };
  });
  return { serverTime: body.serverTime, devices };
}

export function createDevicePresenceService({ config, getSession, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  if (config?.devicePresenceEnabled !== true) return pendingPresenceService;
  return Object.freeze({ async read({ signal } = {}) {
    const controller = new AbortController(); let timer; let abort;
    const deadline = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(new Error('unavailable')); }; timer = setTimeout(abort, 5000);
    });
    signal?.addEventListener('abort', abort, { once: true });
    const request = async () => {
      if (signal?.aborted || !config.configured || typeof getSession !== 'function') throw new Error('unavailable');
      const session = await getSession();
      const token = session?.data?.session?.access_token;
      if (session?.error || typeof token !== 'string' || !token || signal?.aborted || controller.signal.aborted) throw new Error('unavailable');
      const response = await fetchImpl(`${config.origin}/api/device-presence`, { method: 'GET', cache: 'no-store', credentials: 'omit',
        redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!response.ok || !response.headers?.get('content-type')?.includes('application/json')
          || Number(response.headers.get('content-length')) > 8192) throw new Error('unavailable');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0;
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
            if (size > 8192) throw new Error('oversized'); text += decoder.decode(value, { stream: true }); }
          text += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else { text = await response.text(); if (new TextEncoder().encode(text).length > 8192) throw new Error('oversized'); }
      if (signal?.aborted || controller.signal.aborted) throw new Error('unavailable');
      return publicPresence(JSON.parse(text));
    };
    try { return await Promise.race([request(), deadline]); }
    catch { throw new Error('Setup presence unavailable. No device changes were sent.'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } });
}
