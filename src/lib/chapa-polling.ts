import {chapaConfirmed,chapaRecoverable,type ChapaCheckoutView} from './chapa-client';

type Visibility=Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;

/** Checks through the owned server endpoint; never derives success locally. */
export function startChapaPolling(verify:()=>Promise<ChapaCheckoutView|null>,onPause:()=>void,visibility:Visibility=document){
 let active=true,inFlight=false,delay=5000,timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=Date.now()+300000;
 const schedule=()=>{
  if(active&&visibility.visibilityState==='visible')timer=setTimeout(()=>void read(),Math.min(delay,Math.max(0,deadline-Date.now())));
 };
 const read=async()=>{
  if(!active||inFlight||visibility.visibilityState!=='visible')return;
  if(Date.now()>=deadline){onPause();stop();return}
  inFlight=true;
  try{
   const order=await verify();
   if(!active)return;
   if(order){
    if(chapaConfirmed(order)||!chapaRecoverable(order)){stop();return}
    delay=Number.isFinite(order.pollAfterMs)?Math.min(60000,Math.max(5000,order.pollAfterMs)):5000;
   }
  }catch{/* Keep the last authoritative result if verification is unavailable. */}
  finally{inFlight=false;schedule()}
 };
 const onVisibility=()=>{clearTimeout(timer);if(visibility.visibilityState==='visible')void read()};
 function stop(){active=false;clearTimeout(timer);visibility.removeEventListener('visibilitychange',onVisibility)}
 visibility.addEventListener('visibilitychange',onVisibility);
 void read();
 return stop;
}
