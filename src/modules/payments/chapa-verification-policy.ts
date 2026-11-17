type AuthorizationState={chargeType:string;authType:string|null;authorizationReference:string|null;providerStatus:string|null;verificationState:string;createdAt:Date;expiresAt:Date;attempts:number};
const terminal=new Set(['SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED']);
export type ChapaCompletionStatus='SUCCESS'|'FAILED'|'CANCELLED'|'INCOMPLETE'|'EXPIRED'|'BLOCKED'|'FAILED_OR_CANCELLED';
export function chapaCompletionStatus(value:unknown):ChapaCompletionStatus|null{return typeof value==='string'&&terminal.has(value)?value as ChapaCompletionStatus:null}
export const CHAPA_VERIFICATION_LEASE_MS=45000;
// Inline validation is bounded to15s and private verification to10s. Renew a
// delayed claim only while its original fence is still owned, before any HTTP.
export const CHAPA_MIN_VERIFICATION_LEASE_REMAINING_MS=30000;
export const CHAPA_PRIVATE_VERIFICATION_INTERVAL_MS=30000;

/** Inline pending is only a scheduling hint. A recent, successful private
 * lookup is required before saving a redundant GET, and events always bypass
 * this optimization. The periodic private lookup bounds stale public replies. */
export function canSkipChapaPrivateVerification(order:AuthorizationState&{lastPrivateCheckAt?:Date|null},matchingPending:boolean,eventCheck:boolean,now=Date.now()){
 const age=order.lastPrivateCheckAt?now-order.lastPrivateCheckAt.getTime():-1;
 return matchingPending&&!eventCheck&&order.verificationState==='VERIFIED'&&['PENDING','AUTH_NEEDED'].includes(order.providerStatus??'')&&age>=0&&age<CHAPA_PRIVATE_VERIFICATION_INTERVAL_MS;
}

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
