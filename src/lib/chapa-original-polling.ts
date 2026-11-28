import {ChapaClientError,chapaUuid,type ChapaCheckoutView} from './chapa-client';

type Events=Pick<EventTarget,'addEventListener'|'removeEventListener'>;
type Visibility=Events&Pick<Document,'visibilityState'>;
type Telegram={onEvent?:(event:string,listener:()=>void)=>void;offEvent?:(event:string,listener:()=>void)=>void};
type Options={isCurrent:()=>boolean;onError?:(error:unknown)=>void;onPause?:()=>void;onResume?:()=>void;onWalletReturn?:(at:number)=>void;wake?:Events|null;telegram?:Telegram;budgetMs?:number;maximumReads?:number;initialDelayMs?:number};
export const CHAPA_DIRECT_DISCOVERY_DELAY_MS=3000;
const stalledReadMs=2000;

/** Discover an already-owned payment after its initialization reply was
 * lost. The caller supplies GET only; no initialization or fresh key exists in
 * this observer. A missing row may still be committing, so 404 is not failure.
 * Stop before handing the ID to the existing single verification observer. */
export function startChapaOriginalPolling(read:(signal:AbortSignal)=>Promise<ChapaCheckoutView>,onOrder:(order:ChapaCheckoutView)=>void,visibility:Visibility=document,options:Options){
 let active=true,paused=false,away=false,reads=0,lastWakeAt=-Infinity,lastWalletReturnAt=-Infinity,timer:ReturnType<typeof setTimeout>|undefined;
 let flight:{controller:AbortController;startedAt:number}|null=null;
 const budget=Math.max(1,options.budgetMs??30000),maximum=Math.max(1,options.maximumReads??8),wake=options.wake===undefined?(typeof window==='undefined'?null:window):options.wake;
 let deadline=Date.now()+budget,hiddenAt:number|null=visibility.visibilityState==='visible'?null:Date.now();
 const valid=()=>active&&options.isCurrent();
 function stop(){
  active=false;clearTimeout(timer);flight?.controller.abort();visibility.removeEventListener('visibilitychange',onWake);wake?.removeEventListener('focus',onWake);wake?.removeEventListener('online',onReconnect);wake?.removeEventListener('blur',onAway);
  try{options.telegram?.offEvent?.('activated',onActivated);if(options.onWalletReturn)options.telegram?.offEvent?.('deactivated',onAway)}catch{/* Visibility remains a fallback. */}
 }
 function exhausted(){if(!paused&&reads<maximum&&Date.now()<deadline)return false;clearTimeout(timer);if(!paused){paused=true;options.onPause?.()}return true}
 function schedule(){
  clearTimeout(timer);if(!valid()){stop();return}if(visibility.visibilityState!=='visible')return;if(exhausted())return;
  const delay=Math.min(5000,1000*2**Math.min(Math.max(0,reads-1),3));
  timer=setTimeout(()=>void check(),Math.min(delay,Math.max(0,deadline-Date.now())));
 }
 async function check(){
  if(!valid()){stop();return}if(flight||visibility.visibilityState!=='visible'||exhausted())return;
  const readFlight={controller:new AbortController(),startedAt:Date.now()};
  const signal=readFlight.controller.signal;
  clearTimeout(timer);flight=readFlight;reads++;
  let order:ChapaCheckoutView|null=null;
  try{order=await read(signal)}catch(error){
   if(signal.aborted)return;
   if(!valid()){stop();return}
   if(error instanceof ChapaClientError&&[401,403].includes(error.status)){stop();options.onError?.(error);return}
   if(!(error instanceof ChapaClientError&&error.status===404))options.onError?.(error);
  }finally{if(flight===readFlight)flight=null}
  if(signal.aborted)return;
  if(!valid()){stop();return}
  if(order&&chapaUuid.test(order.id)){
   stop();try{onOrder(order)}catch(error){options.onError?.(error)}return;
  }
  schedule();
 }
 function resume(activated=false,reconnected=false){
  if(!valid()){stop();return}
  if(visibility.visibilityState!=='visible'){clearTimeout(timer);if(hiddenAt===null)hiddenAt=Date.now();away=!!options.onWalletReturn;return}
  // A return from a wallet app can emit visibility, focus and online separately,
  // even after a fast read completes. Keep one immediate read for that return.
  const now=Date.now(),wasAway=away,returned=activated||!reconnected&&(wasAway||hiddenAt!==null);
  if(returned){
   away=false;
   // Reconnect and activation can arrive together. Keep the wallet return
   // even when the reconnect already started the fresh read.
   if(now-lastWalletReturnAt>=750){lastWalletReturnAt=now;options.onWalletReturn?.(now)}
  }
  if(hiddenAt===null&&now-lastWakeAt<750&&!wasAway)return;
  lastWakeAt=now;clearTimeout(timer);
  if(paused){paused=false;reads=0;deadline=now+budget;hiddenAt=null;options.onResume?.()}
  else if(hiddenAt!==null){deadline+=Math.max(0,now-hiddenAt);hiddenAt=null;options.onResume?.()}
  // Only creation-time discovery can discard its private read. It is a GET for
  // the original key and uses the same read budget as the ordinary timer.
  if(options.onWalletReturn&&(returned||reconnected)&&flight&&now-flight.startedAt>=stalledReadMs&&reads<maximum&&now<deadline){
   const stale=flight;flight=null;stale.controller.abort();
  }
  void check();
 }
 const onWake=()=>resume();
 const onReconnect=()=>resume(false,true);
 const onActivated=()=>resume(true);
 const onAway=()=>{away=true};
 visibility.addEventListener('visibilitychange',onWake);wake?.addEventListener('focus',onWake);wake?.addEventListener('online',onReconnect);
 if(options.onWalletReturn)wake?.addEventListener('blur',onAway);
 // A native wallet can return to Telegram without a browser focus transition.
 try{options.telegram?.onEvent?.('activated',onActivated);if(options.onWalletReturn)options.telegram?.onEvent?.('deactivated',onAway)}catch{/* Older Telegram clients use visibility/focus. */}
 // Current creation may still be returning normally. Delay background key
 // discovery, while a real foreground return can check immediately via onWake.
 const initialDelay=options.initialDelayMs;
 if(typeof initialDelay==='number'&&Number.isFinite(initialDelay)&&initialDelay>0)timer=setTimeout(()=>void check(),initialDelay);
 else void check();
 return stop;
}
