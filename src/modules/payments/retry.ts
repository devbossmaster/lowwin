export const CUSTOMER_ATTEMPTS=6;
export const STAFF_ATTEMPTS=12;
export const RECOVERY_WINDOW_MS=7*86400000;
export function protectedPayment(t:{status:string;caseState:string}){
 return ['CREDITED','REJECTED','DUPLICATE_CONFLICT','REVERSED','FAILED'].includes(t.status)||['ESCALATED','REVERSAL_REVIEW','ARCHIVED'].includes(t.caseState);
}
export function retryDetails(t:{status:string;caseState:string;attempts:number;expiresAt:Date|null;nextAttemptAt:Date;leaseUntil:Date|null},now=new Date()){
 const retryUntil=t.expiresAt?new Date(t.expiresAt.getTime()+RECOVERY_WINDOW_MS):null;
 const retryBlocked=protectedPayment(t)?'PROTECTED':!retryUntil||now>retryUntil?'EXPIRED':t.attempts>=CUSTOMER_ATTEMPTS?'LIMIT':null;
 return {canRetry:!retryBlocked,retryBlocked,retryUntil:retryUntil?.toISOString(),nextAttemptAt:new Date(Math.max(t.nextAttemptAt.getTime(),t.leaseUntil?.getTime()??0)).toISOString()};
}
