import {AsyncLocalStorage} from 'node:async_hooks';

type Phase='authorization'|'request_body'|'transaction'|'public_cache'|'read'|'media'
 |'deadline_read'|'deadline_write'|'deadline_alerts';
const requestTiming=new AsyncLocalStorage<{started:number;phases:Map<Phase,number>}>();

export async function measureAdmin<T>(phase:Phase,run:()=>Promise<T>):Promise<T>{
 const timing=requestTiming.getStore();
 if(!timing)return run();
 const start=performance.now();
 try{return await run()}finally{
  timing.phases.set(phase,(timing.phases.get(phase)??0)+performance.now()-start);
 }
}

export function adminRequestTimings(){
 const timing=requestTiming.getStore();
 if(!timing)return {};
 return {
  elapsedMs:Math.round(performance.now()-timing.started),
  phasesMs:Object.fromEntries([...timing.phases].map(([name,duration])=>[name,Math.round(duration)])),
 };
}

export function timedAdminResponse(run:()=>Promise<Response>){
 const phases=new Map<Phase,number>(),started=performance.now();
 return requestTiming.run({started,phases},async()=>{
  const response=await run();
  const entries=[...phases].map(([name,duration])=>`admin_${name};dur=${duration.toFixed(1)}`);
  entries.push(`admin_total;dur=${(performance.now()-started).toFixed(1)}`);
  response.headers.set('Server-Timing',entries.join(', '));
  return response;
 });
}
