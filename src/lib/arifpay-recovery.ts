export type ArifPayIntent={auctionSlug:string;amount:string;feeVersion:number;key:string;channel:'TELEBIRR'|'MPESA';phone:string};
export type ArifPayAttempt={version:1;intent:ArifPayIntent;fee?:string;orderId?:string};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readArifPayAttempt(storage:Storage,key:string):ArifPayAttempt|null{
 try{
  const value=JSON.parse(storage.getItem(key)??'null') as ArifPayAttempt|null,i=value?.intent;
  if(value?.version!==1||!i||!uuid.test(i.key)||!['TELEBIRR','MPESA'].includes(i.channel)||typeof i.phone!=='string'||i.phone.length>32||typeof i.auctionSlug!=='string'||typeof i.amount!=='string'||!Number.isInteger(i.feeVersion)||i.feeVersion<1||value.orderId!==undefined&&!uuid.test(value.orderId)||value.fee!==undefined&&typeof value.fee!=='string')return null;
  return value;
 }catch{return null}
}
export function writeArifPayAttempt(storage:Storage,key:string,attempt:ArifPayAttempt){try{storage.setItem(key,JSON.stringify(attempt))}catch{ /* Keep the in-memory intent if storage is unavailable. */ }}
export function clearArifPayAttempt(storage:Storage,key:string){try{storage.removeItem(key);storage.removeItem(`${key}:key`)}catch{}}
export function arifPayPaymentPhone(phone:string,channel:'TELEBIRR'|'MPESA'){
 let value=phone.replace(/[ ()+-]/g,'');if(/^0[79]\d{8}$/.test(value))value=`251${value.slice(1)}`;
 return (channel==='MPESA'?/^2517\d{8}$/:/^2519\d{8}$/).test(value)?value:null;
}
export class ArifPayClientError extends Error {constructor(message:string,readonly status=0,readonly code='UNAVAILABLE'){super(message)}}
export async function requestArifPayJson<T>(url:string,options:RequestInit={},signal?:AbortSignal,timeoutMs=12000):Promise<T>{
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 try{
  const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal});
  const body=await response.json().catch(()=>({}));
  if(controller.signal.aborted)throw new DOMException('Payment request was interrupted.','AbortError');
  if(!response.ok)throw new ArifPayClientError(typeof body.error==='string'?body.error:'Payment status could not load. Keep the same request and retry.',response.status,body.code);
  return body as T;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export function arifPayRecoverable(order:{status:string;reason:string|null;fundsPreserved:boolean}){
 return ['SUBMITTING','PENDING'].includes(order.status)||order.status==='NEEDS_REVIEW'&&!order.fundsPreserved&&order.reason==='PROVIDER_CONFIRMATION_REQUIRED';
}
