import {AsyncLocalStorage} from 'node:async_hooks';

type Phase='oidc_token'|'oidc_profile'|'oidc_identity'|'oidc_transaction'|'oidc_locks'|'oidc_lookup'|'oidc_session'|'me_session'|'me_account';
type Timing={started:number;phases:Map<Phase,number>};
const timingContext=new AsyncLocalStorage<Timing>();

/** Durations only. Never record auth codes, tokens, cookies, claims or identities. */
export async function measureTelegramAuth<T>(phase:Phase,operation:()=>Promise<T>):Promise<T>{
 const timing=timingContext.getStore();if(!timing)return operation();
 const started=performance.now();try{return await operation()}finally{timing.phases.set(phase,(timing.phases.get(phase)??0)+performance.now()-started)}
}

export async function timedTelegramAuthResponse(operation:()=>Promise<Response>){
 const timing:Timing={started:performance.now(),phases:new Map()};
 return timingContext.run(timing,async()=>{
  const response=await operation(),headers=new Headers(response.headers);
  const phases=[...timing.phases].map(([phase,duration])=>`${phase};dur=${duration.toFixed(1)}`);
  phases.push(`oidc_total;dur=${(performance.now()-timing.started).toFixed(1)}`);
  headers.append('Server-Timing',phases.join(', '));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 });
}
