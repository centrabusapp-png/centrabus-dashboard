import { useState } from 'react';
import { ExternalLink, ShieldCheck, Wifi } from 'lucide-react';

export default function LaptopWifiAccess() {
  const [blocked, setBlocked] = useState(false);
  const open = () => {
    // Reuse the launcher's named window without reloading its in-memory private
    // session. No token/password is obtained by or stored in the dashboard.
    const popup = window.open('', 'centrabus-pi2-wifi');
    if (!popup) { setBlocked(true); return; }
    try { if (popup.location.href === 'about:blank') popup.location.href = 'http://127.0.0.1:8765/'; }
    catch { /* Existing private window is another origin: focus it, never read it. */ }
    popup.focus(); setBlocked(false);
  };
  return <section aria-label="Pi2 laptop Wi-Fi settings" className="space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-3"><Wifi size={22} className="mt-0.5 shrink-0 text-[#8E1F2F]" /><div><h3 className="font-extrabold text-slate-900">Choose Pi2’s Wi-Fi from this laptop</h3>
        <p className="mt-1 text-sm text-slate-500">Select TP-Link or another saved network. Your home Wi-Fi can stay on.</p></div></div>
      <button type="button" onClick={open} className="inline-flex items-center gap-2 rounded-xl bg-[#8E1F2F] px-4 py-2.5 text-sm font-bold text-white"><ExternalLink size={15} />Open Wi-Fi settings</button>
    </div>
    <ol className="grid gap-3 text-sm text-slate-700 md:grid-cols-3">
      <li className="rounded-xl border border-slate-200 p-3"><strong className="block text-slate-900">1. Open the Wi-Fi launcher</strong><p className="mt-1 text-xs leading-relaxed">Double-click <b>05 - Pi2 Wi-Fi Settings.cmd</b> in the superbus folder. Enter the normal SSH password in its terminal.</p></li>
      <li className="rounded-xl border border-slate-200 p-3"><strong className="block text-slate-900">2. Scan and choose</strong><p className="mt-1 text-xs leading-relaxed">The private window scans Pi2’s radio and lists its saved networks. Saved passwords stay on the Pi.</p></li>
      <li className="rounded-xl border border-slate-200 p-3"><strong className="block text-slate-900">3. Connect, then Keep</strong><p className="mt-1 text-xs leading-relaxed">Enable trials, select the network and Connect. Join the same target Wi-Fi on this laptop if needed, then Keep after reconnecting.</p></li>
    </ol>
    <p className="flex gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck size={15} className="mt-0.5 shrink-0" />Uses an encrypted SSH tunnel—not another GPS/camera backend. No backend-IP entry or router shutdown is needed. Pi2 must be reachable to start; unconfirmed trials use its native rollback guard.</p>
    {blocked && <p role="status" className="text-xs text-amber-700">Allow this button’s popup, or use the private browser window opened by the Wi-Fi launcher.</p>}
  </section>;
}
