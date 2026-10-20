// Development only: the browser bearer token stays on the Windows host.
// The target must be the same private address on which our launcher binds Express.
import { networkInterfaces } from 'node:os';
export function remoteWifiProxy(mode, env, localAddresses = Object.values(networkInterfaces()).flat().map((row) => row.address)) {
  if (mode !== 'development' || env.VITE_REMOTE_WIFI_ENABLED !== 'true') return {};
  const target = new URL(env.VITE_BACKEND_URL);
  const octets = target.hostname.split('.').map(Number);
  const privateAddress = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  if (target.protocol !== 'http:' || !privateAddress || !localAddresses.includes(target.hostname) || target.port !== '5000' || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash) throw new Error('Invalid local remote-Wi-Fi proxy target.');
  return { '^/api/wifi-remote/devices/GPS-00[12](?:/commands)?$': {
    target: target.origin, changeOrigin: false, followRedirects: false,
    configure(proxy) {
      proxy.on('proxyReq', (request) => request.setHeader('Origin', 'http://localhost:3000'));
    },
  } };
}
