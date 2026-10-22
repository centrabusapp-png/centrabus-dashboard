import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFrameProxy} from './cameraFrameProxy.mjs';
test('camera proxy includes only latest/live reads on the selected own laptop and never production hosting',()=>{
  const env={VITE_CAMERA_FRAMES_ENABLED:'true',VITE_BACKEND_URL:'http://192.168.1.5:5000'};
  const config=cameraFrameProxy('development',env,['192.168.1.5']);
  const pattern=new RegExp(Object.keys(config)[0]);
  for(const path of ['/api/camera-frames/devices/GPS-001/live?preview=1','/api/camera-frames/devices/GPS-002/latest?preview=0'])assert.ok(pattern.test(path));
  for(const path of ['/api/camera-frames/devices/GPS-001/frames','/api/camera-frames/devices/GPS-001/preview','/api/camera-frames/devices/GPS-003/live?preview=1','/api/camera-frames/devices/GPS-001/live?preview=1&target=http://bad'])assert.ok(!pattern.test(path));
  assert.deepEqual(cameraFrameProxy('production',env,['192.168.1.5']),{});
  assert.throws(()=>cameraFrameProxy('development',env,['192.168.1.6']));
});

test('camera recovery proxy rewrites only the backend Host while preserving explicit admin Origin and authentication', () => {
  const env = { VITE_CAMERA_FRAMES_ENABLED: 'true', VITE_LOCAL_NETWORK_RECOVERY: 'true', VITE_BACKEND_URL: 'http://127.0.0.1:5000' };
  const proxy = Object.values(cameraFrameProxy('development', env, []))[0];
  assert.equal(proxy.target, 'http://127.0.0.1:5000');
  assert.equal(proxy.changeOrigin, true); assert.equal(proxy.followRedirects, false);
  const headers = { Authorization: 'Bearer synthetic-only' };
  let handler;
  proxy.configure({ on(event, callback) { assert.equal(event, 'proxyReq'); handler = callback; } });
  handler({ setHeader(name, value) { headers[name] = value; } });
  assert.deepEqual(headers, { Authorization: 'Bearer synthetic-only', Origin: 'http://localhost:3000' });
  assert.deepEqual(cameraFrameProxy('production', env, []), {});
});
