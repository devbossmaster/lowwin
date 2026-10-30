import {chapaConfirmed,chapaSessionEnded,type ChapaCheckoutView} from './chapa-client';

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
 if(chapaSessionEnded(order,now))return 'session-ended';
 if(order&&paused)return 'pending';
 if(error||order?.verificationState==='UNAVAILABLE')return 'unavailable';
 if(order.status==='AUTH_NEEDED')return 'authorization';
 return 'confirming';
}
