import {chapaConfirmed,chapaPollingPaused,type ChapaCheckoutView} from './chapa-client';

export const CHAPA_LONG_WAIT_MS=90000;
/** A quieter presentation after waiting; never changes the payment outcome. */
export function chapaLongWait(order:ChapaCheckoutView|null,now=Date.now()){
 if(!order||chapaConfirmed(order)||!['PENDING','SUBMITTING'].includes(order.status))return false;
 const created=Date.parse(order.createdAt);return Number.isFinite(created)&&now>=created+CHAPA_LONG_WAIT_MS;
}

type State={order:ChapaCheckoutView|null;opening:boolean;restoring:boolean;paused:boolean;error:string;errorCode?:string|null;now?:number};
/** Presentation only. Financial completion always comes from the owned server
 * response, including a receipt for an accepted bid. */
export function chapaPaymentPhase({order,opening,restoring,paused,error,errorCode,now}:State){
 if(order&&chapaConfirmed(order))return order.fundsPreserved?'preserved':'confirmed';
 if(opening)return 'opening';
 if(restoring)return 'restoring';
 if(errorCode&&['UNAUTHORIZED','FORBIDDEN','NOT_FOUND'].includes(errorCode))return 'access';
 if(!order)return 'interrupted';
 if(errorCode==='CONFIGURATION_CHANGED'||order?.verificationState==='MISMATCH'||order?.status==='NEEDS_REVIEW'||order?.status==='BID_ACCEPTED'&&!order.receipt)return 'review';
 if(order&&['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'].includes(order.status))return 'failed';
 if(order.providerStatus==='SUCCESS')return 'applying';
 if(error||order?.verificationState==='UNAVAILABLE')return 'unavailable';
 if(order.status==='AUTH_NEEDED')return 'authorization';
 if(chapaPollingPaused(order,now)||paused)return 'pending';
 return 'confirming';
}
