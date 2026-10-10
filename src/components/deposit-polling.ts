type Result={done?:boolean;retryAfterMs?:number};

// Poll only local, authenticated state. One request at a time, bounded in time;
// pending bank work continues through the webhook/worker after this stops.
export function startDepositPolling(check:(signal:AbortSignal)=>Promise<Result>,visible:()=>boolean,onExpired:()=>void){
 let stopped=false,attempts=0,timer:ReturnType<typeof setTimeout>;
 const started=Date.now(),controller=new AbortController();
 const schedule=(delay:number)=>{timer=setTimeout(()=>void poll(),Math.min(delay,Math.max(0,300000-(Date.now()-started))))};
 const poll=async()=>{
  if(stopped)return;
  if(Date.now()-started>=300000){stopped=true;onExpired();return}
  if(!visible()){schedule(2000);return}
  let result:Result={};
  try{result=await check(AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]))}catch{/* Retry transient reads without changing payment state. */}
  if(stopped||result.done)return;
  attempts++;
  schedule(Math.max(attempts<6?2000:attempts<18?5000:10000,result.retryAfterMs??0));
 };
 schedule(2000);
 return ()=>{stopped=true;clearTimeout(timer);controller.abort()};
}

export function paymentPollRetryAfter(value:string|null){
 if(!value)return undefined;
 const seconds=Number(value);
 const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now();
 return Number.isFinite(delay)&&delay>=0?delay:undefined;
}
