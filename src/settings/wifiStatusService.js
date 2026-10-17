import { pendingWifiService, publicWifiState, WIFI_DEVICES } from './wifiManagementModel';

const MAX_RESPONSE_BYTES = 16 * 1024;

async function readStatusJson(response) {
  if (!response.headers?.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('invalid-status');
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > MAX_RESPONSE_BYTES) throw new Error('oversized-status');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error('oversized-status');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('oversized-status');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Read-only: no method can enqueue commands or accept a password. Remains off
// by default, independently of anything a remote report claims about readiness.
export function createWifiStatusService({ config, getSession, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  if (config?.wifiStatusEnabled !== true) return pendingWifiService;
  return Object.freeze({
    async getState(deviceId, { signal } = {}) {
      if (!WIFI_DEVICES.some((device) => device.id === deviceId)) throw new Error('Unsupported GPS device.');
      if (!config.configured || !config.wifiStatusBaseUrl || typeof getSession !== 'function') {
        throw new Error('Wi-Fi status integration is not configured.');
      }
      const controller = new AbortController();
      let timer;
      let abort;
      const deadline = new Promise((_, reject) => {
        abort = () => { controller.abort(); reject(new Error('status-unavailable')); };
        timer = setTimeout(abort, 4500);
      });
      signal?.addEventListener('abort', abort, { once: true });
      const run = async () => {
        if (signal?.aborted) throw new Error('status-unavailable');
        const session = await getSession();
        if (controller.signal.aborted || signal?.aborted) throw new Error('status-unavailable');
        const token = session?.data?.session?.access_token;
        if (session?.error || typeof token !== 'string' || !token) throw new Error('status-unavailable');
        const response = await fetchImpl(`${config.wifiStatusBaseUrl}/${encodeURIComponent(deviceId)}`, {
          method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('status-unavailable');
        const body = await readStatusJson(response);
        if (body?.ok !== true || body.simulation === true || body.state?.simulation === true) throw new Error('invalid-status');
        return publicWifiState(body.state, deviceId);
      };
      try { return await Promise.race([run(), deadline]); }
      catch { throw new Error('Wi-Fi status unavailable. No device changes were sent.'); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  });
}
