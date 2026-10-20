import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {localCameraCapture,createLocalCaptureMiddleware} from './localCameraCapture.mjs';

const TEMP=resolve('../qa/.results/temp');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function setup(t){
  await mkdir(TEMP,{recursive:true});
  const root=await mkdtemp(join(TEMP,'capture-fixture-')),directory=join(root,'captured-images');
  let allowed=true,calls=0;
  const middleware=createLocalCaptureMiddleware({target:'http://192.168.1.5:5000',directory,
    fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://192.168.1.5:5000/api/camera-frames/devices/GPS-002/live?preview=0');
      assert.equal(options.headers.Authorization,'Bearer synthetic');
      return {ok:allowed,status:allowed?200:403,json:async()=>({ok:true,deviceId:'GPS-002',state:'waiting',frame:null})};}});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});
    assert.ok(root.startsWith(TEMP+requireSeparator()));await rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}/api/local-camera-captures/GPS-002`;
  const headers={Host:'127.0.0.1:3000',Origin:'http://127.0.0.1:3000',Authorization:'Bearer synthetic',
    'X-CentraBus-Capture':'manual-v1','X-Camera-Capture-Id':'session:1','Content-Type':'image/png'};
  return {root,directory,url,headers,revoke:()=>{allowed=false;},calls:()=>calls,
    post:(body=png,changes={})=>new Promise((resolve,reject)=>{
      const req=request(url,{method:'POST',headers:{...headers,...changes}},res=>{
        let text='';res.on('data',data=>{text+=data;});
        res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(text)}));
      });req.on('error',reject);req.end(body);
    })};
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}

test('disabled outside explicit local development; target must be this laptop',()=>{
  const env={VITE_CAMERA_FRAMES_ENABLED:'true',VITE_BACKEND_URL:'http://192.168.1.5:5000'};
  assert.equal(localCameraCapture('production',env).configureServer,undefined);
  assert.equal(localCameraCapture('development',{...env,VITE_CAMERA_FRAMES_ENABLED:'false'}).configureServer,undefined);
  assert.throws(()=>localCameraCapture('development',env,['192.168.1.6']));
  assert.equal(typeof localCameraCapture('development',env,['192.168.1.5']).configureServer,'function');
});
test('only an explicit authorized PNG POST writes one new unique file to the fixed folder',async t=>{
  const s=await setup(t);assert.deepEqual(await readdir(s.root),[]);
  const get=await fetch(s.url,{headers:s.headers});assert.equal(get.status,405);assert.deepEqual(await readdir(s.root),[]);
  const one=await s.post();assert.equal(one.status,201);const first=await one.json();
  assert.equal(first.saved,true);assert.equal(first.relativePath,`captured-images/${first.filename}`);
  assert.deepEqual(await readFile(join(s.directory,first.filename)),png);
  const two=await s.post();assert.equal(two.status,201);const second=await two.json();
  assert.notEqual(first.filename,second.filename);assert.equal((await readdir(s.directory)).length,2);
  assert.equal(s.calls(),2);
});
test('cross-origin, arbitrary host, missing approval/auth and invalid image/path data write nothing',async t=>{
  const s=await setup(t);
  for(const headers of [{Origin:'http://evil.invalid'},{Host:'evil.invalid:3000'},
    {'X-CentraBus-Capture':''},{Authorization:''},{'X-Camera-Capture-Id':'../../outside'},
    {'Content-Type':'application/json'}])assert.ok((await s.post(png,headers)).status>=400);
  assert.equal((await s.post(Buffer.from('not a PNG'))).status,400);
  const huge=Buffer.from(png);huge.writeUInt32BE(10000,16);assert.equal((await s.post(huge)).status,400);
  assert.equal(s.calls(),0);assert.deepEqual(await readdir(s.root),[]);
});
test('backend rejection prevents saving even a structurally valid image',async t=>{
  const s=await setup(t);s.revoke();assert.equal((await s.post()).status,403);
  assert.deepEqual(await readdir(s.root),[]);
});
