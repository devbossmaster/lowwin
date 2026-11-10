/** Ordinary payment copy, separate from bid acceptance and diagnostic states.
 * A timer, redirect or missing response is never evidence of failed payment. */
export type PaymentSummaryState='done'|'failed'|'checking';
export type PaymentSummaryEvidence={completed:boolean;providerStatus?:string|null;verificationState?:string|null};
const terminalProviderStates=new Set(['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED']);
export function paymentSummaryState(evidence:PaymentSummaryEvidence):PaymentSummaryState{
 if(evidence.completed)return 'done';
 return evidence.verificationState==='VERIFIED'&&terminalProviderStates.has(evidence.providerStatus??'')?'failed':'checking';
}
export function paymentSummaryLabel(state:PaymentSummaryState,am=false){return ({done:['Done','ተጠናቋል'],failed:['Failed','አልተሳካም'],checking:['Checking payment…','ክፍያው በማረጋገጥ ላይ…']} as const)[state][am?1:0]}
