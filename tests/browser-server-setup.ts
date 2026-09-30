import type {FullConfig} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createConnection} from 'node:net';

type Spec={kind:'next'|'email'|'payments';port:number;env?:Record<string,string>};
type Owned={child:ChildProcess;spec:Spec;exit:Promise<number|null>;closed:boolean};
async function portOpen(port:number){return new Promise<boolean>(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const finish=(open:boolean)=>{socket.destroy();resolve(open)};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(false))})}
export async function stopOwnedServer(owned:Owned,timeout=15000){
 if(owned.closed)throw Error(`Test server ${owned.spec.port} exited before teardown`);
 owned.child.send('shutdown',()=>{});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const code=await Promise.race([owned.exit,new Promise<'timeout'>(resolve=>{timer=setTimeout(()=>resolve('timeout'),timeout)})]);
 clearTimeout(timer);
 if(code==='timeout'){
  // Target only the child created by this run. Never kill by port or process name.
  owned.child.kill('SIGKILL');if(owned.child.connected)owned.child.disconnect();owned.child.unref();
  throw Error(`Test server ${owned.spec.port} did not stop within ${timeout}ms`);
 }
 if(code!==(owned.spec.kind==='next'?143:0))throw Error(`Test server ${owned.spec.port} shutdown failed (exit ${code})`);
 if(await portOpen(owned.spec.port))throw Error(`Test server port ${owned.spec.port} still listening after shutdown`);
 console.log(`[TestServer] ${owned.spec.port} stopped; port released`);
}
export default async function setup(config:FullConfig){
 const owned:Owned[]=[];
 const cleanup=async()=>{const results=await Promise.allSettled([...owned].reverse().map(server=>stopOwnedServer(server)));const errors=results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason);if(errors.length)throw new AggregateError(errors,'Browser test server cleanup failed')};
 try{
  for(const spec of config.metadata.testServers as Spec[]){
   if(await portOpen(spec.port))throw Error(`Test port ${spec.port} is already in use; refusing to reuse or kill another process`);
   const child=spawn(process.execPath,['--import','tsx','scripts/browser-test-server.mjs',spec.kind,String(spec.port)],{shell:false,windowsHide:true,stdio:['ignore','inherit','inherit','ipc'],env:{...process.env,...spec.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'}});
   const record:Owned={child,spec,closed:false,exit:Promise.resolve(null)};
   record.exit=new Promise(resolve=>child.once('exit',code=>{record.closed=true;resolve(code)}));owned.push(record);
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Test server ${spec.port} startup timed out`)),120000);const ready=(message:unknown)=>{if(message&&typeof message==='object'&&'ready'in message){clearTimeout(timer);child.off('message',ready);resolve()}};child.on('message',ready);child.once('error',e=>{clearTimeout(timer);reject(e)});record.exit.then(()=>{clearTimeout(timer);reject(Error(`Test server ${spec.port} exited during startup`))})});
   for(let attempt=0;;attempt++){try{const response=await fetch(`http://127.0.0.1:${spec.port}/${spec.kind==='next'?'api/health/live':'health'}`,{signal:AbortSignal.timeout(3000)});if(response.ok)break}catch{}if(attempt>=60)throw Error(`Test server ${spec.port} health check timed out`);await delay(250)}
  }
  return cleanup;
 }catch(error){try{await cleanup()}catch(cleanupError){throw new AggregateError([error,cleanupError],'Browser setup and cleanup failed')}throw error}
}
