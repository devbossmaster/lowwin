import type {BidReceipt} from '@/modules/auctions/bids';
import type {ChapaApiErrorCategory} from './chapa-api-error';

export type ChapaIntent={key:string;purpose:'TOP_UP';amount:string}|{key:string;purpose:'BID';auctionSlug:string;amount:string;feeVersion:number;couponId?:string};
export type ChapaCheckoutView={providerStatus?:string|null;providerReasonCode?:string|null;verificationState?:string;initializationIssue?:ChapaApiErrorCategory|null;merchantReference?:string;paymentMethod?:string|null;auctionTitle?:string|null;auctionTitleAm?:string|null;auctionCode?:string|null;auctionStatus?:string|null;auctionEndsAt?:string|null;id:string;purpose:'TOP_UP'|'BID';mode:'test'|'live';amount:string;amountCents:string;currency:'ETB';status:string;reason:string|null;checkoutUrl:string|null;auctionSlug:string|null;bidNumber:string|null;feeVersion:number|null;grossFee:string|null;discountPoints:string;createdAt:string;expiresAt:string;pollAfterMs:number;fundsPreserved:boolean;receipt:BidReceipt|null};
export type ChapaAvailability={enabled:boolean;configured:boolean;mode:'test'|'live';walletBidsEnabled:boolean;minTopup:string;maxTopup:string;reason:string|null};
export type ChapaAttempt={version:1;intent:ChapaIntent;orderId?:string};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export const chapaUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const amount=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

export function readChapaAttempt(storage:Storage,key:string):ChapaAttempt|null{
 try{
  const value=JSON.parse(storage.getItem(key)??'null') as ChapaAttempt|null,i=value?.intent;
  if(value?.version!==1||!i||!chapaUuid.test(i.key)||typeof i.amount!=='string'||!amount.test(i.amount)||value.orderId!==undefined&&!chapaUuid.test(value.orderId))return null;
  if(i.purpose==='TOP_UP')return Object.keys(i).some(k=>!['key','purpose','amount'].includes(k))?null:value;
  if(i.purpose!=='BID'||typeof i.auctionSlug!=='string'||!/^[a-z0-9-]{1,120}$/.test(i.auctionSlug)||!Number.isSafeInteger(i.feeVersion)||i.feeVersion<1||i.couponId!==undefined&&!chapaUuid.test(i.couponId)||Object.keys(i).some(k=>!['key','purpose','amount','auctionSlug','feeVersion','couponId'].includes(k)))return null;
  return value;
 }catch{return null}
}
export function writeChapaAttempt(storage:Storage,key:string,value:ChapaAttempt){try{storage.setItem(key,JSON.stringify(value))}catch{/* The original intent remains in memory when storage is unavailable. */}}
export function clearChapaAttempt(storage:Storage,key:string){try{storage.removeItem(key)}catch{}}
export function clearChapaAttempts(storage:Pick<globalThis.Storage,'length'|'key'|'removeItem'>,keepIdentity:string|null=null){
 try{for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith('lowwin:chapa:')&&(!keepIdentity||!key.startsWith(`lowwin:chapa:${keepIdentity}:`)))storage.removeItem(key)}}catch{}
}
export function chapaCheckoutUrl(value:string|null|undefined):string|null{
 try{if(!value||/[\u0000-\u0020\\]/.test(value))return null;const url=new URL(value);return url.protocol==='https:'&&url.hostname==='checkout.chapa.global'&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.length>1?url.href:null}catch{return null}
}
export function chapaConfirmed(order:Pick<ChapaCheckoutView,'purpose'|'status'|'fundsPreserved'|'receipt'>){return order.fundsPreserved||order.purpose==='TOP_UP'&&order.status==='CREDITED'||order.purpose==='BID'&&order.status==='BID_ACCEPTED'&&!!order.receipt}
export const CHAPA_CHECKOUT_POLL_MS=5*60*1000;
/** Bound foreground checks from the saved attempt, without changing the
 * provider's checkout validity or payment outcome when this time elapses. */
export function chapaPollingDeadline(order:Pick<ChapaCheckoutView,'createdAt'>):number|null{
 const created=Date.parse(order.createdAt);return Number.isFinite(created)?created+CHAPA_CHECKOUT_POLL_MS:null;
}
export function chapaPollingPaused(order:ChapaCheckoutView,now=Date.now()){
 if(chapaConfirmed(order)||order.providerStatus==='SUCCESS'||!['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status))return false;
 const deadline=chapaPollingDeadline(order);return deadline!==null&&now>=deadline;
}
/** Recovery initialization needs the saved intent, even if the first response
 * supplied an ID without a URL. Review/terminal orders must only be checked. */
export function chapaCanResumeCheckout(attempt:ChapaAttempt|null,order:ChapaCheckoutView|null){
 if(!attempt)return false;
 if(!order)return !attempt.orderId;
 if(order.initializationIssue==='state')return false;
 return !order.checkoutUrl&&!chapaConfirmed(order)&&['SUBMITTING','PENDING'].includes(order.status)&&(!order.reason||['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_REFERENCE_UNAVAILABLE','PROVIDER_EVENT_RECEIVED'].includes(order.reason));
}
export function chapaRecoverable(order:Pick<ChapaCheckoutView,'status'|'fundsPreserved'>){return !order.fundsPreserved&&!['CREDITED','BID_ACCEPTED','FAILED','CANCELLED','EXPIRED','BLOCKED','INCOMPLETE'].includes(order.status)}
export class ChapaClientError extends Error{constructor(message:string,readonly status=0,readonly code='UNAVAILABLE'){super(message)}}
export async function requestChapaJson<T>(url:string,options:RequestInit={},signal?:AbortSignal,timeoutMs=15000):Promise<T>{
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
 try{
  const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal}),body=await response.json().catch(()=>({}));
  if(controller.signal.aborted)throw new DOMException('Payment request interrupted.','AbortError');
  if(!response.ok)throw new ChapaClientError(typeof body.error==='string'?body.error:'Payment status could not be checked. Retry this same payment.',response.status,typeof body.code==='string'?body.code:'UNAVAILABLE');
  return body as T;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
