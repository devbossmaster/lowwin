import {ChapaClientError,chapaUuid,type ChapaCheckoutView} from './chapa-client';

type Events=Pick<EventTarget,'addEventListener'|'removeEventListener'>;
type Visibility=Events&Pick<Document,'visibilityState'>;
type Options={isCurrent:()=>boolean;onError?:(error:unknown)=>void;onPause?:()=>void;onResume?:()=>void;wake?:Events|null;budgetMs?:number;maximumReads?:number};

/** Discover an already-owned Inline attempt after its initialization reply was
 * lost. The caller supplies GET only; no initialization or fresh key exists in
 * this observer. A missing row may still be committing, so 404 is not failure.
 * Stop before handing the ID to the existing single verification observer. */
export function startChapaOriginalPolling(read:(signal:AbortSignal)=>Promise<ChapaCheckoutView>,onOrder:(order:ChapaCheckoutView)=>void,visibility:Visibility=document,options:Options){
 let active=true,paused=false,inFlight=false,reads=0,lastWakeAt=-Infinity,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|null=null;
 const budget=Math.max(1,options.budgetMs??30000),maximum=Math.max(1,options.maximumReads??8),wake=options.wake===undefined?(typeof window==='undefined'?null:window):options.wake;
 let deadline=Date.now()+budget,hiddenAt:number|null=visibility.visibilityState==='visible'?null:Date.now();
 const valid=()=>active&&options.isCurrent();
 function stop(){active=false;clearTimeout(timer);controller?.abort();visibility.removeEventListener('visibilitychange',onWake);wake?.removeEventListener('focus',onWake);wake?.removeEventListener('online',onWake)}
 function exhausted(){if(!paused&&reads<maximum&&Date.now()<deadline)return false;clearTimeout(timer);if(!paused){paused=true;options.onPause?.()}return true}
 function schedule(){
  clearTimeout(timer);if(!valid()){stop();return}if(visibility.visibilityState!=='visible')return;if(exhausted())return;
  const delay=Math.min(5000,1000*2**Math.min(Math.max(0,reads-1),3));
  timer=setTimeout(()=>void check(),Math.min(delay,Math.max(0,deadline-Date.now())));
 }
 async function check(){
  if(!valid()){stop();return}if(inFlight||visibility.visibilityState!=='visible'||exhausted())return;
  clearTimeout(timer);inFlight=true;controller=new AbortController();reads++;
  let order:ChapaCheckoutView|null=null;
  try{order=await read(controller.signal)}catch(error){
   if(!valid()){stop();return}
   if(error instanceof ChapaClientError&&[401,403].includes(error.status)){stop();options.onError?.(error);return}
   if(!(error instanceof ChapaClientError&&error.status===404))options.onError?.(error);
  }finally{inFlight=false;controller=null}
  if(!valid()){stop();return}
  if(order&&chapaUuid.test(order.id)){
   stop();try{onOrder(order)}catch(error){options.onError?.(error)}return;
  }
  schedule();
 }
 function onWake(){
  if(!valid()){stop();return}
  if(visibility.visibilityState!=='visible'){clearTimeout(timer);if(hiddenAt===null)hiddenAt=Date.now();return}
  // A return from a wallet app can emit visibility, focus and online separately,
  // even after a fast read completes. Keep one immediate read for that return.
  const now=Date.now();if(hiddenAt===null&&now-lastWakeAt<750)return;lastWakeAt=now;clearTimeout(timer);
  if(paused){paused=false;reads=0;deadline=now+budget;hiddenAt=null;options.onResume?.()}
  else if(hiddenAt!==null){deadline+=Math.max(0,now-hiddenAt);hiddenAt=null;options.onResume?.()}
  void check();
 }
 visibility.addEventListener('visibilitychange',onWake);wake?.addEventListener('focus',onWake);wake?.addEventListener('online',onWake);
 void check();return stop;
}
