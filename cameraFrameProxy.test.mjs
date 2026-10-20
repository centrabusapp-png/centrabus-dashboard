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
