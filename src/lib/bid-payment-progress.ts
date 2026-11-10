import {chapaAwaitingAuthorization,chapaVerifiedTerminal,chapaConfirmed,chapaDirectRequestRejected,chapaPollingPaused,type ChapaCheckoutView} from './chapa-client';
import {CHAPA_LONG_WAIT_MS,chapaLongWait} from './chapa-status';
import {normalizePaymentPhone} from './payment-phone';

export type BidPaymentProgressPhase='preparing'|'connecting'|'authorization'|'confirming'|'success'|'preserved'|'terminal'|'uncertain';
type ProgressState={order:ChapaCheckoutView|null;busy:boolean;restoring:boolean;paused:boolean;error:string;errorCode?:string|null;started?:boolean;preparing?:boolean;walletRetry?:boolean;hasReceipt?:boolean;now?:number};

/** A retry can return to entry only after an owned, terminal server outcome.
 * Display deadlines, transport errors and provider success never qualify. */
export function bidPaymentCanRetry(order:ChapaCheckoutView|null){
 if(!order||order.fundsPreserved||chapaConfirmed(order)||order.providerStatus==='SUCCESS'||order.verificationState==='MISMATCH')return false;
 if(order.reason==='INITIALIZATION_REJECTED'&&chapaDirectRequestRejected(order))return true;
 return ['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED'].includes(order.status)&&chapaVerifiedTerminal(order);
}

/** Retry only the frozen direct intent when initialization has no accepted
 * authorization reference. An owned ID still supports the same operation. */
export function bidPaymentCanRetryOriginal(order:ChapaCheckoutView|null){
 if(!order)return true;
 return order.chargeType==='DIRECT'&&['SUBMITTING','PENDING'].includes(order.status)&&!order.authorizationReference&&!chapaConfirmed(order)&&order.providerStatus!=='SUCCESS'&&order.verificationState!=='MISMATCH'&&order.initializationIssue!=='state'&&!chapaDirectRequestRejected(order);
}

/** A provider success awaiting Lowwin's receipt remains confirming. The
 * existing display clock quiets this wait without inventing acceptance. */
export function bidPaymentApplicationDelayed(order:ChapaCheckoutView|null,paused=false,now=Date.now()){
 if(!order||order.providerStatus!=='SUCCESS'||chapaConfirmed(order))return false;
 return paused||chapaPollingPaused(order,now)||chapaLongWait(order,now)||now>=Date.parse(order.createdAt)+CHAPA_LONG_WAIT_MS;
}
/** Connection health is secondary to accepted provider state. It cannot
 * authorize a fresh attempt or imply that a phone prompt was cancelled. */
export function bidPaymentConnectionDelayed(state:ProgressState){
 const order=state.order;
 return !!order&&!chapaConfirmed(order)&&!chapaVerifiedTerminal(order)&&(!!state.error||order.verificationUnavailable===true||order.verificationState==='UNAVAILABLE'||state.paused||chapaPollingPaused(order,state.now)||chapaLongWait(order,state.now)||(state.now??Date.now())>=Date.parse(order.createdAt)+CHAPA_LONG_WAIT_MS);
}

/** Presentation only: a received provider payment is still confirming until
 * Lowwin returns an accepted-bid receipt. OTP errors retain the same form. */
export function bidPaymentProgressPhase(state:ProgressState):BidPaymentProgressPhase{
 const {order,error,errorCode}=state;
 if(state.hasReceipt)return 'success';
 if(order?.fundsPreserved)return 'preserved';
 if(order&&chapaConfirmed(order))return 'success';
 if(bidPaymentCanRetry(order))return 'terminal';
 if(state.preparing&&!state.started&&!order)return 'preparing';
 if(state.walletRetry)return 'uncertain';
 if(errorCode&&['UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFIGURATION_CHANGED'].includes(errorCode))return 'uncertain';
 if(!order)return state.busy||state.restoring?'connecting':'uncertain';
 if(order.verificationState==='MISMATCH'||order.status==='NEEDS_REVIEW'||chapaDirectRequestRejected(order))return 'uncertain';
 if(order.providerStatus==='SUCCESS')return 'confirming';
 if(order.status==='BID_ACCEPTED'||order.status==='EXPIRED')return 'uncertain';
 if(state.busy&&!order.authorizationReference&&['SUBMITTING','PENDING'].includes(order.status))return 'connecting';
 if(chapaAwaitingAuthorization(order))return 'authorization';
 if(error||order.verificationState==='UNAVAILABLE'||state.paused||chapaPollingPaused(order,state.now)||chapaLongWait(order,state.now))return 'uncertain';
 if(!order.authorizationReference&&['SUBMITTING','PENDING'].includes(order.status))return 'connecting';
 return 'confirming';
}

/** Never expose a draft or server-supplied full phone number in the summary. */
export function maskedBidPaymentPhone(phone:string|null|undefined){
 if(!phone)return null;
 const normalized=normalizePaymentPhone(phone);
 if(normalized)return `+251 ••• •• ${normalized.slice(-4)}`;
 if(!/[•*xX]/.test(phone))return null;
 const trailing=phone.match(/\d{2,4}$/)?.[0];
 return trailing?`+251 ••• •• ${trailing}`:null;
}
