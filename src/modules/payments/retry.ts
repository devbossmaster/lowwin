export const CUSTOMER_ATTEMPTS=6;
export const STAFF_ATTEMPTS=12;
export const RECOVERY_WINDOW_MS=7*86400000;
export const WEBHOOK_REVIEW_AFTER_MS=60*60*1000;
export const WEBHOOK_RECHECK_MS=30*60*1000;
export function protectedPayment(t:{status:string;caseState:string}){
 return ['CREDITED','REJECTED','DUPLICATE_CONFLICT','REVERSED','FAILED'].includes(t.status)||['ESCALATED','REVERSAL_REVIEW','ARCHIVED'].includes(t.caseState);
}
export function retryDetails(t:{status:string;caseState:string;reasonCode?:string|null;attempts:number;expiresAt:Date|null;nextAttemptAt:Date;leaseUntil:Date|null},now=new Date()){
 const retryUntil=t.expiresAt?new Date(t.expiresAt.getTime()+RECOVERY_WINDOW_MS):null;
 const retryBlocked=protectedPayment(t)?'PROTECTED':t.reasonCode==='WEBHOOK_DELAYED'?'WEBHOOK_DELAYED':!retryUntil||now>retryUntil?'EXPIRED':t.attempts>=CUSTOMER_ATTEMPTS?'LIMIT':null;
 return {canRetry:!retryBlocked,retryBlocked,retryUntil:retryUntil?.toISOString(),nextAttemptAt:new Date(Math.max(t.nextAttemptAt.getTime(),t.leaseUntil?.getTime()??0)).toISOString()};
}
export function imageWebhookWait(createdAt:Date,expiresAt:Date|null,now=new Date()){
 const retryUntil=expiresAt?new Date(expiresAt.getTime()+RECOVERY_WINDOW_MS):null;
 return {
  delayed:now.getTime()-createdAt.getTime()>=WEBHOOK_REVIEW_AFTER_MS,
  expired:!retryUntil||now>retryUntil,
  nextCheckAt:new Date(Math.min(now.getTime()+WEBHOOK_RECHECK_MS,retryUntil?.getTime()??now.getTime())),
 };
}
