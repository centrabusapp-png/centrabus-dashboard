'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {validateReleaseFiles}=require('./release-files.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'centrabus-hosted-release-'));
 const files=['vercel.json','package.json','package-lock.json','deployment/launch-profile.json','.gitignore','.vercelignore'];
 for(const name of files){const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',name),target);}
 t.after(()=>{for(const name of files){const target=path.join(dir,name);if(fs.existsSync(target))fs.unlinkSync(target);}fs.rmdirSync(path.join(dir,'deployment'));fs.rmdirSync(dir);});
 return dir;
}
test('Vercel build inputs can omit the local ignore files without bypassing other config checks',t=>{
 const dir=fixture(t);fs.unlinkSync(path.join(dir,'.gitignore'));fs.unlinkSync(path.join(dir,'.vercelignore'));
 assert.deepEqual(validateReleaseFiles(dir,{hostedBuild:true}),[]);
 assert.ok(validateReleaseFiles(dir,{hostedBuild:false}).length);
 const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));pkg.engines.node='20.x';fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));
 assert.ok(validateReleaseFiles(dir,{hostedBuild:true}).some(s=>s.includes('Node 22')));
});
test('a supplied ignore file must still exclude environment files on the host',t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'.vercelignore'),'node_modules\n');
 assert.ok(validateReleaseFiles(dir,{hostedBuild:true}).some(s=>s.includes('.vercelignore')));
});
