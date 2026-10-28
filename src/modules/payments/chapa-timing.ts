import {AsyncLocalStorage} from 'node:async_hooks';

type Phase='auth'|'checkout'|'database'|'initialize'|'verify';
type Timing={started:number;phases:Map<Phase,number>};
const requestTiming=new AsyncLocalStorage<Timing>();

/** Request-scoped durations only: no identifiers, queries or provider data. */
export async function measureChapa<T>(phase:Phase,operation:()=>Promise<T>):Promise<T>{
 const timing=requestTiming.getStore();if(!timing)return operation();
 const started=performance.now();
 try{return await operation()}finally{timing.phases.set(phase,(timing.phases.get(phase)??0)+performance.now()-started)}
}

export async function timedChapaResponse(operation:()=>Promise<Response>){
 const timing:Timing={started:performance.now(),phases:new Map()};
 return requestTiming.run(timing,async()=>{
  const response=await operation();
  const values=[...timing.phases].map(([phase,duration])=>`${phase};dur=${duration.toFixed(1)}`);
  values.push(`total;dur=${(performance.now()-timing.started).toFixed(1)}`);
  response.headers.set('Server-Timing',values.join(', '));return response;
 });
}
