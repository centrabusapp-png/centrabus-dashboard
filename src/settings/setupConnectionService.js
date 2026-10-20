const LIMIT = 16 * 1024;

async function healthJson(response) {
  if (!response.ok || !response.headers?.get('content-type')?.toLowerCase().includes('application/json')
      || Number(response.headers.get('content-length')) > LIMIT) throw new Error('invalid-health');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > LIMIT) throw new Error('invalid-health');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) throw new Error('invalid-health');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// One explicit browser -> configured API check. Never scans a LAN, contacts a
// Pi, sends a password, or proves the Pi's Wi-Fi/Internet is connected.
export async function checkSetupBackend({ config, signal, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  if (!config?.configured || !config.origin || config.healthUrl !== `${config.origin}/health`) {
    throw new Error('Backend address is not configured.');
  }
  const controller = new AbortController();
  let timer;
  let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new Error('unavailable')); };
    timer = setTimeout(abort, 4500);
  });
  signal?.addEventListener('abort', abort, { once: true });
  const read = async () => {
    if (signal?.aborted) throw new Error('unavailable');
    const response = await fetchImpl(config.healthUrl, { method: 'GET', cache: 'no-store', credentials: 'omit',
      redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal });
    const body = await healthJson(response);
    if (body?.ok !== true || body.simulation === true || signal?.aborted || controller.signal.aborted) throw new Error('invalid-health');
    // Do not propagate arbitrary backend payloads/errors into the setup screen.
    return { checkedAt: Date.now(), reachable: true };
  };
  try { return await Promise.race([read(), deadline]); }
  catch { throw new Error('Backend check failed. Check its address, server availability and browser access. No device changes were sent.'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
