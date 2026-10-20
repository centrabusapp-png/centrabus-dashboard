// Local Vite development server only. An explicit Capture POST writes one PNG
// to a fixed laptop folder; no image endpoint, automatic recording or pathname
// supplied by the browser. Existing backend admin authorization is required.
import { mkdir, open, realpath, lstat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { remoteWifiProxy } from './remoteWifiProxy.mjs';

const DIRECTORY=resolve(fileURLToPath(new URL('..',import.meta.url)),'captured-images');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const LIMIT=20*1024*1024;
const HOSTS=new Set(['127.0.0.1:3000','localhost:3000']);
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function pngSize(bytes){
  if(bytes.length<33||!bytes.subarray(0,8).equals(PNG)||bytes.readUInt32BE(8)!==13
    ||bytes.toString('ascii',12,16)!=='IHDR')throw Error('invalid-png');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>8192||height>8192||width*height>16000000)throw Error('invalid-png');
  let offset=8,ended=false,data=false;
  while(offset+12<=bytes.length){
    const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
    if(size>LIMIT||offset+12+size>bytes.length)throw Error('invalid-png');
    if(type==='IDAT')data=true;
    offset+=12+size;
    if(type==='IEND'){ended=size===0&&offset===bytes.length;break;}
  }
  if(!ended||!data)throw Error('invalid-png');
}

export function createLocalCaptureMiddleware({target,directory=DIRECTORY,fetchImpl=fetch}={}){
  let writing=false;
  return async(req,res,next)=>{
    const match=/^\/api\/local-camera-captures\/(GPS-00[12])$/.exec(req.url||'');
    if(!match)return next();
    const reply=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');
      res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
    if(req.method!=='POST')return reply(405,{ok:false,error:'capture-post-required'});
    const host=req.headers.host,token=req.headers.authorization;
    if(!loopback(req.socket.remoteAddress)||!HOSTS.has(host)||req.headers.origin!==`http://${host}`
      ||req.headers['x-centrabus-capture']!=='manual-v1'
      ||!/^Bearer [^\s]{1,8192}$/.test(token||''))return reply(403,{ok:false,error:'local-capture-not-authorized'});
    if(req.headers['content-type']!=='image/png'||req.headers['content-encoding']
      ||!validId(req.headers['x-camera-capture-id']))return reply(400,{ok:false,error:'invalid-capture'});
    if(writing)return reply(429,{ok:false,error:'capture-busy'});
    writing=true;
    let bytes=null,handle=null,createdPath=null;
    try{
      const parts=[];let size=0;
      for await(const part of req){size+=part.length;if(size>LIMIT)throw Error('capture-too-large');parts.push(part);}
      bytes=Buffer.concat(parts);pngSize(bytes);
      // No camera image is fetched or written by this authorization check.
      const auth=await fetchImpl(`${target}/api/camera-frames/devices/${match[1]}/live?preview=0`,{
        headers:{Authorization:token,Origin:`http://${host}`},redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!auth.ok) return reply(auth.status===401||auth.status===403?403:503,{ok:false,error:'capture-admin-check-failed'});
      const verified=await auth.json();
      if(verified.ok!==true||verified.deviceId!==match[1]||!['live','waiting'].includes(verified.state))
        return reply(403,{ok:false,error:'capture-camera-not-authorized'});
      await mkdir(directory,{recursive:true});
      const stat=await lstat(directory);
      if(stat.isSymbolicLink()||!stat.isDirectory()||resolve(await realpath(directory))!==resolve(directory))throw Error('invalid-capture-folder');
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const filename=`centrabus-${match[1]}-${stamp}-${randomUUID().slice(0,8)}.png`;
      const output=join(directory,filename);
      handle=await open(output,'wx',0o600);createdPath=output;
      await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      createdPath=null;reply(201,{ok:true,saved:true,filename,relativePath:`captured-images/${filename}`});
    }catch(error){
      if(handle){await handle.close().catch(()=>{});handle=null;}
      if(createdPath)await unlink(createdPath).catch(()=>{});
      reply(error.message==='capture-too-large'?413:400,{ok:false,error:'capture-not-saved'});
    }
    finally{if(handle)await handle.close().catch(()=>{});bytes=null;writing=false;}
  };
}

export function localCameraCapture(mode,env,addresses){
  if(mode!=='development'||env.VITE_CAMERA_FRAMES_ENABLED!=='true')return {name:'centrabus-local-capture-disabled'};
  const proxy=Object.values(remoteWifiProxy(mode,{...env,VITE_REMOTE_WIFI_ENABLED:'true'},addresses))[0];
  return {name:'centrabus-local-manual-capture',configureServer(server){
    server.middlewares.use(createLocalCaptureMiddleware({target:proxy.target}));
  }};
}
