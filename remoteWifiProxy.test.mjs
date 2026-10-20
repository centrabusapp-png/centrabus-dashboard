import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteWifiProxy } from './remoteWifiProxy.mjs';
const env = { VITE_REMOTE_WIFI_ENABLED: 'true', VITE_BACKEND_URL: 'http://192.168.1.5:5000' };
test('proxy is opt-in, development-only and limited to admin Wi-Fi paths', () => {
  assert.deepEqual(remoteWifiProxy('production', env), {});
  assert.deepEqual(remoteWifiProxy('development', {}), {});
  const [pattern, proxy] = Object.entries(remoteWifiProxy('development', env, ['192.168.1.5']))[0];
  const allowed = new RegExp(pattern);
  assert.ok(allowed.test('/api/wifi-remote/devices/GPS-002/commands'));
  for (const path of ['/api/gps/update', '/api/wifi-remote/poll', '/api/wifi-remote/devices/GPS-003', '/api/wifi-remote/devices/GPS-002/commands/other']) assert.ok(!allowed.test(path));
  assert.equal(proxy.target, env.VITE_BACKEND_URL); assert.equal(proxy.followRedirects, false);
  let event, handler; proxy.configure({ on: (name, callback) => { event = name; handler = callback; } });
  assert.equal(event, 'proxyReq'); handler({ setHeader: (name, value) => { assert.equal(name, 'Origin'); assert.equal(value, 'http://localhost:3000'); } });
});
test('arbitrary public, loopback, credentialed or path-based targets fail closed', () => {
  for (const url of ['https://example.com', 'http://127.0.0.1:5000', 'http://192.168.1.5:1234', 'http://user:secret@192.168.1.5:5000', 'http://192.168.1.5:5000/other', 'http://192.168.1.5:5000/?x=1']) {
    assert.throws(() => remoteWifiProxy('development', { ...env, VITE_BACKEND_URL: url }, ['192.168.1.5']));
  }
  assert.throws(() => remoteWifiProxy('development', env, ['192.168.1.6']));
});
