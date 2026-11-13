type AuthorizationState={chargeType:string;authType:string|null;authorizationReference:string|null;providerStatus:string|null;verificationState:string;createdAt:Date;expiresAt:Date;attempts:number};
const terminal=new Set(['SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED']);

/** A locally assigned display expiry cannot cancel a provider authorization.
 * Privately verified terminal state needs only a fresh merchant lookup, which
 * can still reconcile a late success without polling the old phone prompt. */
export function shouldRefreshChapaAuthorization(order:AuthorizationState){
 return order.authType==='USSD'&&!!order.authorizationReference&&!(order.verificationState==='VERIFIED'&&terminal.has(order.providerStatus??''));
}

/** Faster refresh is limited to the first minute of an open authorization.
 * Later pending checks retain the existing cadence and recovery backoff. */
export function chapaPendingVerificationDelay(order:AuthorizationState,authorizationFlow:boolean,now=Date.now()){
 if(authorizationFlow&&order.expiresAt.getTime()>now)return now-order.createdAt.getTime()<60000?5000:15000;
 return Math.min(300000,15000*Math.max(1,Math.floor(order.attempts/4)));
}
