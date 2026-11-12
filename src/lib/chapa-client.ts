import type {BidReceipt} from '@/modules/auctions/bids';
import type {ChapaApiErrorCategory} from './chapa-api-error';
import type {BidBatchQuote,ChapaDirectIntent} from './bid-batch-client';

export type ChapaIntent={key:string;purpose:'TOP_UP';amount:string}|{key:string;purpose:'BID';auctionSlug:string;amount:string;feeVersion:number;couponId?:string};
export type ChapaCheckoutView=DirectCheckoutFields&{providerStatus?:string|null;providerReasonCode?:string|null;verificationState?:string;initializationIssue?:ChapaApiErrorCategory|null;merchantReference?:string;paymentMethod?:string|null;auctionTitle?:string|null;auctionTitleAm?:string|null;auctionCode?:string|null;auctionStatus?:string|null;auctionEndsAt?:string|null;id:string;purpose:'TOP_UP'|'BID';mode:'test'|'live';amount:string;amountCents:string;currency:'ETB';status:string;reason:string|null;checkoutUrl:string|null;auctionSlug:string|null;bidNumber:string|null;feeVersion:number|null;grossFee:string|null;discountPoints:string;createdAt:string;expiresAt:string;pollAfterMs:number;fundsPreserved:boolean;receipt:BidReceipt|null};
export type ChapaAvailability={enabled:boolean;configured:boolean;mode:'test'|'live';walletBidsEnabled:boolean;minTopup:string;maxTopup:string;reason:string|null};
export type DirectCheckoutFields={apiVersion?:'v1'|'v2';flowVersion?:number;chargeType?:'DIRECT'|'HOSTED'|'INLINE';authType?:'USSD'|'OTP'|null;authorizationReference?:string|null;payerPhoneMasked?:string|null;batch?:BidBatchQuote|null;batchNumbers?:string[];receipts?:BidReceipt[];initializationReasonCode?:string|null;updatedAt?:string;verificationUnavailable?:boolean};
export type ChapaCheckoutConfig={apiVersion?:'v1'|'v2';enabled:boolean;configured:boolean;mode:'test'|'live';minTopup:string;maxTopup:string;methods:import('./bid-batch-client').DirectPaymentMethod[];phone:string|null;cbeBankEnabled:boolean;cbeGuideUrl:string|null};
export type ChapaV1Config=ChapaCheckoutConfig;
export type ChapaAttempt={version:1;intent:ChapaIntent;orderId?:string};
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export const chapaUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const amount=/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

/** New v2 Inline attempts use our owned server adapter. Legacy v1 SDK attempts
 * remain version-bound and are never sent to the new creation endpoint. */
export function chapaOriginalKeyUrl(intent:ChapaDirectIntent|null|undefined){
 if(!intent||!chapaUuid.test(intent.key))return null;
 const base=intent.apiVersion==='v1'?'/api/payments/chapa/v1':intent.apiVersion==='v2'&&intent.kind==='inline'?'/api/payments/chapa/inline':null;
 return base?`${base}?key=${encodeURIComponent(intent.key)}`:null;
}
export function chapaApiCharge(order:Pick<DirectCheckoutFields,'chargeType'|'apiVersion'|'flowVersion'>){return order.chargeType==='DIRECT'||order.apiVersion==='v2'&&order.flowVersion===4&&order.chargeType==='INLINE'}
export function chapaCurrentInline(order:Pick<DirectCheckoutFields,'apiVersion'|'flowVersion'>){return order.apiVersion==='v2'&&order.flowVersion===4}

/** A failed restore read must keep observing the original owned resource.
 * Wait for the first read to finish; authorization failures require login or
 * ownership correction, never another automatic request or a new charge. */
export function chapaRestorePollingId(state:{order:ChapaCheckoutView|null;recoveryId:string|null;restoring:boolean;errorCode:string|null}):string|null{
 if(state.order||state.restoring||!state.recoveryId||!chapaUuid.test(state.recoveryId)||['UNAUTHORIZED','FORBIDDEN','NOT_FOUND'].includes(state.errorCode??''))return null;
 return state.recoveryId.toLowerCase();
}

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
 try{if(!value||/[\u0000-\u0020\\]/.test(value))return null;const url=new URL(value);return url.protocol==='https:'&&['checkout.chapa.global','checkout.chapa.co'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.length>1?url.href:null}catch{return null}
}
export function chapaConfirmed(order:Pick<ChapaCheckoutView,'purpose'|'status'|'fundsPreserved'|'receipt'>){return order.fundsPreserved||order.purpose==='TOP_UP'&&order.status==='CREDITED'||order.purpose==='BID'&&order.status==='BID_ACCEPTED'&&!!order.receipt}
/** A structured rejected initialization is not an outstanding phone prompt.
 * Historical rows may still say PENDING; verified outcomes take precedence. */
export function chapaDirectRequestRejected(order:ChapaCheckoutView|null){
 return !!order&&chapaApiCharge(order)&&!order.authorizationReference&&!chapaConfirmed(order)&&!order.providerStatus&&order.verificationState!=='MISMATCH'&&['SUBMITTING','PENDING','NEEDS_REVIEW'].includes(order.status)&&order.initializationIssue==='request';
}
const terminalProviderStates=new Set(['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED']);
export function chapaVerifiedTerminal(order:ChapaCheckoutView|null){return !!order&&order.verificationState==='VERIFIED'&&terminalProviderStates.has(order.providerStatus??'')}
/** Accepted authorization is provider state. A transport error or a local
 * display/checking deadline cannot revoke it. Recorded expiry is not proof of
 * failure: a fresh owned server check must establish the terminal outcome. */
export function chapaAwaitingAuthorization(order:ChapaCheckoutView|null){
 return !!order&&chapaApiCharge(order)&&!!order.authorizationReference&&['USSD','OTP'].includes(order.authType??'')&&['SUBMITTING','PENDING','AUTH_NEEDED','VERIFYING'].includes(order.status)&&!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&order.verificationState!=='MISMATCH'&&!chapaVerifiedTerminal(order);
}
/** Concurrent status/OTP responses can arrive in a different order. Never
 * replace authoritative completion with an older unconfirmed snapshot. */
export function acceptChapaSnapshot(previous:ChapaCheckoutView|null,next:ChapaCheckoutView){
 if(!previous||previous.id!==next.id)return true;
 if(chapaConfirmed(previous)&&!chapaConfirmed(next))return false;
 if(previous.verificationState==='MISMATCH'&&['UNAVAILABLE','UNVERIFIED',undefined].includes(next.verificationState))return false;
 if(chapaVerifiedTerminal(previous)&&!chapaVerifiedTerminal(next)&&next.providerStatus!=='SUCCESS'&&!chapaConfirmed(next))return false;
 if(previous.providerStatus==='SUCCESS'&&next.providerStatus!=='SUCCESS'&&!chapaConfirmed(next))return false;
 // A slower pre-cancellation read must not restart a completed phone prompt.
 // A later server-verified success can still reconcile a late payment.
 if(!chapaRecoverable(previous)&&['SUBMITTING','PENDING','AUTH_NEEDED'].includes(next.status)&&next.providerStatus!=='SUCCESS'&&!chapaConfirmed(next))return false;
 const before=Date.parse(previous.updatedAt??''),after=Date.parse(next.updatedAt??'');
 return !Number.isFinite(before)||!Number.isFinite(after)||after>=before;
}
export const CHAPA_CHECKOUT_POLL_MS=5*60*1000;
/** Bound foreground checks from the saved attempt, without changing the
 * provider's checkout validity or payment outcome when this time elapses. */
export function chapaPollingDeadline(order:Pick<ChapaCheckoutView,'createdAt'>&Partial<Pick<ChapaCheckoutView,'chargeType'|'expiresAt'|'apiVersion'|'flowVersion'>>):number|null{
 if(chapaApiCharge(order)||chapaCurrentInline(order)||order.apiVersion==='v1'){const expiry=Date.parse(order.expiresAt??'');return Number.isFinite(expiry)?expiry:null}
 const created=Date.parse(order.createdAt);return Number.isFinite(created)?created+CHAPA_CHECKOUT_POLL_MS:null;
}
export function chapaPollingPaused(order:ChapaCheckoutView,now=Date.now()){
 if(chapaApiCharge(order)||chapaCurrentInline(order)||order.apiVersion==='v1')return false;
 if(chapaConfirmed(order)||order.providerStatus==='SUCCESS'||!['SUBMITTING','PENDING','AUTH_NEEDED'].includes(order.status))return false;
 const deadline=chapaPollingDeadline(order);return deadline!==null&&now>=deadline;
}
/** Recovery initialization needs the saved intent, even if the first response
 * supplied an ID without a URL. Review/terminal orders must only be checked. */
export function chapaCanResumeCheckout(attempt:ChapaAttempt|null,order:ChapaCheckoutView|null){
 if(!attempt)return false;
 if(!order)return !attempt.orderId;
 if(order.initializationIssue==='state'||chapaDirectRequestRejected(order))return false;
 return !order.checkoutUrl&&!chapaConfirmed(order)&&['SUBMITTING','PENDING'].includes(order.status)&&(!order.reason||['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_REFERENCE_UNAVAILABLE','PROVIDER_EVENT_RECEIVED'].includes(order.reason));
}
export function chapaRecoverable(order:Pick<ChapaCheckoutView,'status'|'fundsPreserved'>){return !order.fundsPreserved&&!['CREDITED','BID_ACCEPTED','FAILED','CANCELLED','EXPIRED','BLOCKED','INCOMPLETE','FAILED_OR_CANCELLED'].includes(order.status)}
export type WalletPaymentShortfall={available:string;required:string;shortfall:string;currency:'ETB'};
export class ChapaClientError extends Error{constructor(message:string,readonly status=0,readonly code='UNAVAILABLE',readonly wallet?:WalletPaymentShortfall){super(message)}}
export async function requestChapaJson<T>(url:string,options:RequestInit={},signal?:AbortSignal,timeoutMs=15000):Promise<T>{
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
 try{
  const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal}),body=await response.json().catch(()=>({}));
  if(controller.signal.aborted)throw new DOMException('Payment request interrupted.','AbortError');
  if(!response.ok){const raw=body.wallet,wallet=raw&&raw.currency==='ETB'&&['available','required','shortfall'].every(key=>typeof raw[key]==='string'&&/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw[key]))?raw as WalletPaymentShortfall:undefined;throw new ChapaClientError(typeof body.error==='string'?body.error:'Payment status could not be checked. Retry this same payment.',response.status,typeof body.code==='string'?body.code:'UNAVAILABLE',wallet)}
  return body as T;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
