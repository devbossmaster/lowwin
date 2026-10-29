import {ChapaClientError,chapaConfirmed,chapaRecoverable,type ChapaCheckoutView} from './chapa-client';

type Events=Pick<EventTarget,'addEventListener'|'removeEventListener'>;
type Visibility=Events&Pick<Document,'visibilityState'>;
type Options={onError?:(error:unknown)=>void;onResume?:()=>void;wake?:Events|null};

/** Bounded automatic checks of the owned endpoint. Returning to the app wakes a
 * paused check; no pending/error/redirect is ever converted into success. */
export function startChapaPolling(verify:()=>Promise<ChapaCheckoutView|null>,onPause:()=>void,visibility:Visibility=document,options:Options={}){
 let active=true,paused=false,inFlight=false,delay=5000,timer:ReturnType<typeof setTimeout>|undefined;
 let deadline=Date.now()+300000;
 const wake=options.wake===undefined?(typeof window==='undefined'?null:window):options.wake;
 const schedule=()=>{
  clearTimeout(timer);
  if(active&&!paused&&visibility.visibilityState==='visible')timer=setTimeout(()=>void read(),Math.min(delay,Math.max(0,deadline-Date.now())));
 };
 const read=async()=>{
  if(!active||inFlight||paused||visibility.visibilityState!=='visible')return;
  clearTimeout(timer);
  if(Date.now()>=deadline){paused=true;onPause();return}
  inFlight=true;
  try{
   const order=await verify();
   if(!active)return;
   if(order){
    if(chapaConfirmed(order)||!chapaRecoverable(order)){stop();return}
    delay=Number.isFinite(order.pollAfterMs)?Math.min(60000,Math.max(5000,order.pollAfterMs)):5000;
   }
  }catch(error){
   if(!active)return;
   options.onError?.(error);
   if(error instanceof ChapaClientError&&[401,403,404].includes(error.status)){stop();return}
   delay=Math.min(30000,delay*2);
  }finally{inFlight=false;schedule()}
 };
 const onWake=()=>{
  clearTimeout(timer);
  if(!active||visibility.visibilityState!=='visible')return;
  if(paused){paused=false;deadline=Date.now()+300000;options.onResume?.()}
  void read();
 };
 function stop(){
  active=false;clearTimeout(timer);visibility.removeEventListener('visibilitychange',onWake);
  wake?.removeEventListener('focus',onWake);wake?.removeEventListener('online',onWake);
 }
 visibility.addEventListener('visibilitychange',onWake);
 wake?.addEventListener('focus',onWake);wake?.addEventListener('online',onWake);
 void read();
 return stop;
}
