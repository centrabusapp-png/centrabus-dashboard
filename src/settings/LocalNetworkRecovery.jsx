import { useEffect, useState } from 'react';
const phases = {
  starting: 'Starting laptop apps', discovering: 'Finding Pi2 on the current network',
  connecting: 'Connecting sender session · check terminal prompts', reconnecting: 'Network changed · reconnecting',
  running: 'Pi2 sender session running', 'needs-attention': 'Terminal needs attention', stopped: 'Session stopped',
  'camera-blocked': 'GPS session running · camera needs attention in MAIN CONTROL',
  'camera-retrying': 'GPS session running · retrying camera connection',
};
const browserRequest = (...args) => fetch(...args);
export default function LocalNetworkRecovery({ config, request = browserRequest }) {
  const enabled = config?.localNetworkRecoveryEnabled === true;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true, timer, controller;
    const poll = async () => {
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const reply = await request('http://127.0.0.1:5000/api/local-session', {
          signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'omit',
        });
        if (!reply.ok) throw Error('unavailable');
        const body = await reply.json();
        if (body.enabled !== true || !Object.hasOwn(phases, body.phase)
          || !Number.isFinite(body.updatedAt) || JSON.stringify(body).length > 1024) throw Error('invalid');
        if (active) setState(body);
      } catch { if (active) setState(null); }
      finally { clearTimeout(timeout); if (active) timer = setTimeout(poll, 2000); }
    };
    void poll(); return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, [enabled, request]);
  if (!enabled) return null;
  return <section aria-label="Automatic backend recovery" className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
    <h3 className="font-extrabold text-slate-800">Automatic backend recovery · Pi2</h3>
    <p role="status" className="mt-1 font-semibold">{state ? phases[state.phase] : 'Local launcher status unavailable'}</p>
    <p className="mt-1 text-slate-600">Last discovered endpoints · Laptop LAN: {state?.laptopAddress || 'Waiting'} · Pi2: {state?.piAddress || 'Waiting'}</p>
    <p className="mt-1 text-slate-500">GPS and camera destinations update together. No saved Wi-Fi profile or private configuration is rewritten. Session running does not prove a fresh GPS fix or detected gauges.</p>
  </section>;
}
