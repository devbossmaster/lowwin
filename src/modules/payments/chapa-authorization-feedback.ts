import type {ChapaCheckout} from '@prisma/client';
import {normalizePaymentPhone} from '@/lib/payment-phone';
import {safeChapaPaymentReason,type ChapaPaymentReasonCode} from '@/lib/chapa-payment-reason';
import {decryptPhone} from '../auth/own-contact';
import {ChapaProviderError,parseChapaEvidence} from './chapa-provider';
import {matchesChapaMetadata} from './chapa-metadata';

export type ChapaAuthorizationFeedback={kind:'rejected';code:ChapaPaymentReasonCode}|{kind:'waiting'};
const rejection=(code:ChapaPaymentReasonCode|null|undefined)=>code&&code!=='AUTHORIZATION_REQUIRED'?code:null;

/** Only a response bound to this frozen authorization may update its feedback.
 * This is supplementary authorization state, never private payment evidence. */
export function chapaAuthorizationFeedback(raw:unknown,order:ChapaCheckout):ChapaAuthorizationFeedback|undefined{
 const proof=parseChapaEvidence(raw);
 if(!proof||!order.authorizationReference||proof.chapaReference!==order.authorizationReference||proof.merchantReference!==order.merchantReference||proof.amountCents!==String(order.amountCents)||proof.currency!==order.currency||proof.paymentMethod!==order.paymentMethod||proof.mode&&proof.mode!==order.mode||!matchesChapaMetadata(order.initialization,proof.meta,order.id))return;
 if(proof.customer?.phone_number)try{if(normalizePaymentPhone(proof.customer.phone_number)!==normalizePaymentPhone(decryptPhone(order.payerPhoneCipher!,order.phoneBotId!)))return}catch{return}
 const code=rejection(proof.reasonCode);
 if(['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'].includes(proof.status))return {kind:'rejected',code:code??(proof.status==='CANCELLED'?'PAYMENT_CANCELLED':proof.status==='EXPIRED'?'PAYMENT_EXPIRED':proof.status==='BLOCKED'?'PAYMENT_BLOCKED':'AUTHORIZATION_FAILED')};
 if(proof.status==='AUTH_NEEDED'&&code)return {kind:'rejected',code};
 return {kind:'waiting'};
}

/** The documented HTTP/code structure is authoritative for this request only.
 * Never derive account/PIN/funds errors from message strings or transport loss. */
export function chapaAuthorizationErrorFeedback(error:unknown):ChapaAuthorizationFeedback|undefined{
 if(!(error instanceof ChapaProviderError)||![400,422].includes(error.httpStatus))return;
 const code=rejection(safeChapaPaymentReason(error.paymentReason));
 return code?{kind:'rejected',code}:undefined;
}

export const chapaAuthorizationFeedbackReason=(feedback:ChapaAuthorizationFeedback)=>feedback.kind==='rejected'?`CHAPA_AUTHORIZATION_${feedback.code}`:null;
