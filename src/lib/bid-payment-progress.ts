import {chapaConfirmed,chapaDirectRequestRejected,chapaPollingPaused,chapaRecoverable,type ChapaCheckoutView} from './chapa-client';
import {CHAPA_LONG_WAIT_MS,chapaLongWait} from './chapa-status';
import {normalizePaymentPhone} from './payment-phone';

export type BidPaymentProgressPhase='preparing'|'connecting'|'authorization'|'confirming'|'success'|'preserved'|'terminal'|'uncertain';
type ProgressState={order:ChapaCheckoutView|null;busy:boolean;restoring:boolean;paused:boolean;error:string;errorCode?:string|null;started?:boolean;preparing?:boolean;walletRetry?:boolean;hasReceipt?:boolean;now?:number};

/** A retry can return to entry only after an owned, terminal server outcome.
 * Display deadlines, transport errors and provider success never qualify. */
export function bidPaymentCanRetry(order:ChapaCheckoutView|null){
 if(!order||order.fundsPreserved||chapaConfirmed(order)||order.providerStatus==='SUCCESS'||order.verificationState==='MISMATCH')return false;
 if(order.reason==='INITIALIZATION_REJECTED'&&chapaDirectRequestRejected(order))return true;
 if(['FAILED','CANCELLED','INCOMPLETE','BLOCKED'].includes(order.status))return true;
 return order.status==='EXPIRED'&&order.providerStatus==='EXPIRED'&&order.verificationState==='VERIFIED';
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
 if(order.verificationState==='MISMATCH'||order.status==='NEEDS_REVIEW'||order.status==='BID_ACCEPTED'||order.status==='EXPIRED'||chapaDirectRequestRejected(order))return 'uncertain';
 if(order.providerStatus==='SUCCESS')return 'confirming';
 if(state.busy&&!order.authorizationReference&&['SUBMITTING','PENDING'].includes(order.status))return 'connecting';
 const otp=order.chargeType==='DIRECT'&&order.authType==='OTP'&&!!order.authorizationReference&&chapaRecoverable(order);
 if(otp&&(!error||errorCode==='INVALID_OTP'))return 'authorization';
 if(error||order.verificationState==='UNAVAILABLE'||state.paused||chapaPollingPaused(order,state.now)||chapaLongWait(order,state.now))return 'uncertain';
 if(order.authorizationReference&&order.authType==='USSD'&&chapaRecoverable(order))return 'authorization';
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
