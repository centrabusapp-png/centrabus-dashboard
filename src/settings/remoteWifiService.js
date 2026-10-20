export const pendingRemoteWifiService = Object.freeze({ enabled: false });
const ids = ['GPS-001', 'GPS-002'];
const tasks = ['idle', 'authorizing', 'connecting', 'awaiting_confirmation', 'applied', 'rolled_back', 'failed', 'unknown'];
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
export function remoteWifiState(body, deviceId) {
  if (body?.ok !== true || body.deviceId !== deviceId || typeof body.online !== 'boolean' || !Number.isSafeInteger(body.serverTime)) throw new Error('invalid');
  if (!body.online) return { deviceId, online: false, report: null, pendingCommandId: null };
  const r = body.report;
  if (!Number.isSafeInteger(body.receivedAt) || body.serverTime < body.receivedAt || body.serverTime - body.receivedAt > 15000
    || !r || r.protocolVersion !== 2 || !identifier(r.sessionId) || !Number.isSafeInteger(r.sequence) || r.sequence < 1 || !Number.isSafeInteger(r.observedAt)
    || Math.abs(body.serverTime - r.observedAt) > 15000 || !tasks.includes(r.task)
    || typeof r.connectEnabled !== 'boolean' || ![true, false, null].includes(r.wifiConnected)
    || !['full', 'limited', 'portal', 'none', 'unknown'].includes(r.internet)
    || r.publicKey !== null && (typeof r.publicKey !== 'string' || r.publicKey.length > 900)
    || r.connectEnabled && !r.publicKey || r.trialId !== null && !identifier(r.trialId)
    || r.deadline !== null && !Number.isSafeInteger(r.deadline)
    || body.pendingCommandId !== null && !identifier(body.pendingCommandId)
    || !Array.isArray(r.networks) || r.networks.length > 64 || !Array.isArray(r.savedProfiles) || r.savedProfiles.length > 32
    || !['not_checked', 'ready', 'unavailable'].includes(r.profilesStatus)
    || [r.networksObservedAt, r.profilesObservedAt].some((stamp) => stamp !== null && (!Number.isSafeInteger(stamp) || stamp > body.serverTime + 5000))
    || r.profilesStatus === 'ready' && r.profilesObservedAt === null
    || r.profilesStatus !== 'ready' && (r.savedProfiles.length || r.profilesObservedAt !== null)) throw new Error('invalid');
  const seen = new Set();
  for (const row of r.networks) {
    if (!identifier(row.id) || seen.has(row.id) || typeof row.ssid !== 'string' || new TextEncoder().encode(row.ssid).length > 32
    || row.ssid.length < 1 || /[\x00-\x1f\x7f]/.test(row.ssid)
    || !['wpa2-personal', 'wpa3-personal', 'unsupported'].includes(row.security) || !Number.isInteger(row.signal)
    || row.signal < 0 || row.signal > 100 || typeof row.connected !== 'boolean') throw new Error('invalid');
    seen.add(row.id);
  }
  const profileIds = new Set();
  for (const row of r.savedProfiles) {
    if (typeof row.profileId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(row.profileId)
      || profileIds.has(row.profileId) || !/^[a-f0-9]{64}$/.test(row.profileVersion)
      || typeof row.ssid !== 'string' || !row.ssid.length || new TextEncoder().encode(row.ssid).length > 32 || /[\x00-\x1f\x7f]/.test(row.ssid)
      || !['wpa2-personal', 'wpa3-personal', 'unsupported'].includes(row.security)
      || !Number.isInteger(row.priority) || row.priority < -999 || row.priority > 999
      || typeof row.available !== 'boolean' || ![true, false, null].includes(row.connected)
      || row.signal !== null && (!Number.isInteger(row.signal) || row.signal < 0 || row.signal > 100)
      || row.available !== (row.signal !== null)) throw new Error('invalid');
    profileIds.add(row.profileId);
  }
  if (r.lastResult !== null && (!identifier(r.lastResult?.commandId) || !['accepted', 'applied', 'failed', 'expired', 'unknown'].includes(r.lastResult.outcome))) throw new Error('invalid');
  const report = { protocolVersion: 2, sessionId: r.sessionId, sequence: r.sequence, observedAt: r.observedAt, publicKey: r.publicKey,
    connectEnabled: r.connectEnabled, wifiConnected: r.wifiConnected, internet: r.internet, task: r.task, trialId: r.trialId,
    deadline: r.deadline, networks: r.networks.map(({ id, ssid, security, signal, connected }) => ({ id, ssid, security, signal, connected })),
    savedProfiles: r.savedProfiles.map(({ profileId, profileVersion, ssid, security, priority, available, signal, connected }) => ({ profileId, profileVersion, ssid, security, priority, available, signal, connected }))
      .sort((a, b) => Number(b.connected === true) - Number(a.connected === true) || Number(b.available) - Number(a.available) || (b.signal ?? -1) - (a.signal ?? -1) || b.priority - a.priority || a.ssid.localeCompare(b.ssid)),
    profilesStatus: r.profilesStatus, profilesObservedAt: r.profilesObservedAt, networksObservedAt: r.networksObservedAt,
    lastResult: r.lastResult ? { commandId: r.lastResult.commandId, outcome: r.lastResult.outcome } : null };
  return { deviceId, online: true, report, pendingCommandId: body.pendingCommandId,
    remainingMs: Math.max(0, Math.min(15000 - (body.serverTime - body.receivedAt), 15000 - (body.serverTime - r.observedAt))),
    scanRemainingMs: r.networksObservedAt === null ? 0 : Math.max(0, Math.min(60000, 60000 - (body.serverTime - r.networksObservedAt))),
    profilesRemainingMs: r.profilesObservedAt === null ? 0 : Math.max(0, Math.min(60000, 60000 - (body.serverTime - r.profilesObservedAt))),
    trialRemainingMs: Number.isSafeInteger(r.deadline) ? Math.max(0, r.deadline - body.serverTime) : 0 };
}
export async function encryptWifiPassword({ publicKey, password, label, cryptoImpl = globalThis.crypto }) {
  if (typeof password !== 'string' || !/^[\x20-\x7e]{8,63}$/.test(password) || typeof publicKey !== 'string' || publicKey.length > 900 || !cryptoImpl?.subtle) throw new Error('encryption-unavailable');
  const text = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  const key = await cryptoImpl.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const encrypted = await cryptoImpl.subtle.encrypt({ name: 'RSA-OAEP', label: new TextEncoder().encode(label) }, key, new TextEncoder().encode(password));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}
async function boundedEncryption(encrypt, value, signal) {
  let timer; let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new Error('Cancelled.'));
    timer = setTimeout(abort, 6000);
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    if (signal?.aborted) throw new Error('Cancelled.');
    return await Promise.race([encrypt(value), cancelled]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function createRemoteWifiService({ config, getSession, fetchImpl = (...args) => fetch(...args), encrypt = encryptWifiPassword } = {}) {
  if (config?.remoteWifiEnabled !== true) return pendingRemoteWifiService;
  async function request(deviceId, suffix = '', body, signal) {
    if (!ids.includes(deviceId) || !config.configured || signal?.aborted) throw new Error('unavailable');
    const controller = new AbortController(); let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const abort = () => { controller.abort(); rejectDeadline(new Error('unavailable')); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 6000);
    const perform = async () => {
      const session = await getSession(); const token = session?.data?.session?.access_token;
      if (typeof token !== 'string' || !token || signal?.aborted || controller.signal.aborted) throw new Error('auth');
      // Vite's opt-in local-only proxy keeps the admin token on this laptop.
      // Never send it directly over the shared HTTP LAN to a Pi or server.
      const response = await fetchImpl(`/api/wifi-remote/devices/${deviceId}${suffix}`, {
        method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok || !response.headers?.get('content-type')?.includes('application/json')) throw new Error('rejected');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0;
        try {
          for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
            if (size > 24576) throw new Error('oversized'); text += decoder.decode(chunk.value, { stream: true }); }
          text += decoder.decode();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else { text = await response.text(); if (new TextEncoder().encode(text).length > 24576) throw new Error('oversized'); }
      if (signal?.aborted || controller.signal.aborted) throw new Error('cancelled');
      return JSON.parse(text);
    };
    try { return await Promise.race([perform(), deadline]); }
    catch { throw new Error('Remote Wi-Fi request unavailable or rejected. Refresh status before retrying.'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return Object.freeze({ enabled: true,
    async read(deviceId, { signal } = {}) { return remoteWifiState(await request(deviceId, '', null, signal), deviceId); },
    async command(state, operation, payload = {}, { signal, commandId = globalThis.crypto.randomUUID() } = {}) {
      if (!state.online || signal?.aborted || !['scan', 'connect', 'connect_saved', 'keep', 'rollback'].includes(operation)) throw new Error('Device is not currently verified.');
      const r = state.report;
      let outgoing = payload;
      if (operation === 'connect') {
        try {
          outgoing = { networkId: payload.networkId, priority: payload.priority, passwordCiphertext: await boundedEncryption(encrypt, {
            publicKey: r.publicKey, password: payload.password, label: `centrabus-remote-wifi-v1:${state.deviceId}:${r.sessionId}:${commandId}` }, signal) };
        } finally { payload.password = ''; }
      }
      if (signal?.aborted) throw new Error('Cancelled.');
      const reply = await request(state.deviceId, '/commands', { commandId, sessionId: r.sessionId,
        expectedReportSequence: r.sequence, operation, payload: outgoing }, signal);
      if (reply.ok !== true || reply.commandId !== commandId) throw new Error('Command acknowledgement not verified.');
      return reply;
    },
  });
}
