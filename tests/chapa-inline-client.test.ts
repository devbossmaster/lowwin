import {describe,expect,it} from 'vitest';
import type {ChapaDirectIntent} from '../src/lib/bid-batch-client';
import {chapaApiCharge,chapaAwaitingAuthorization,chapaCurrentInline,chapaDirectRequestRejected,chapaOriginalKeyUrl,chapaPollingDeadline,chapaPollingPaused,type ChapaCheckoutView} from '../src/lib/chapa-client';
import {bidPaymentCanRetry,bidPaymentCanRetryOriginal,bidPaymentProgressPhase} from '../src/lib/bid-payment-progress';
import {chapaLongWait,chapaPaymentPhase} from '../src/lib/chapa-status';
import {QueryClient} from '@tanstack/react-query';
import {readChapaOriginalAttempt,retainChapaOriginalAttempt} from '../src/lib/chapa-original-attempt';
import {readPaymentRetryDraft,retainPaymentRetryDraft} from '../src/lib/payment-retry-draft';

const key='28ebbe58-2e53-4f8f-a47d-91de854395f6',created=Date.parse('2026-11-12T08:00:00Z');
const intent:ChapaDirectIntent={key,apiVersion:'v2',kind:'inline',flow:'INLINE',purpose:'TOP_UP',paymentMethod:'telebirr',phone:'251911000000',amount:'35.00'};
const order={id:key,apiVersion:'v2',flowVersion:4,chargeType:'INLINE',purpose:'TOP_UP',status:'AUTH_NEEDED',authType:'USSD',authorizationReference:'CH-original',providerStatus:'AUTH_NEEDED',verificationState:'UNVERIFIED',fundsPreserved:false,receipt:null,createdAt:new Date(created).toISOString(),expiresAt:new Date(created+5*60000).toISOString()} as ChapaCheckoutView;
const progress={order,busy:false,restoring:false,paused:false,error:'',now:created};

describe('v2 Inline frontend keeps the owned payment version and outcome',()=>{
 it('resolves an interrupted response through the version-specific owned key lookup',()=>{
  expect(chapaOriginalKeyUrl(intent)).toBe('/api/payments/chapa/inline?key='+key);
  expect(chapaOriginalKeyUrl({...intent,apiVersion:'legacy',kind:undefined} as unknown as ChapaDirectIntent)).toBeNull();
  expect(chapaOriginalKeyUrl({...intent,apiVersion:undefined,kind:undefined,flow:undefined})).toBeNull();
  expect(chapaOriginalKeyUrl({...intent,kind:undefined})).toBeNull();
  expect(chapaOriginalKeyUrl({...intent,key:'../other-account'})).toBeNull();
  expect(chapaOriginalKeyUrl(null)).toBeNull();
 });
 it('preserves the v2 Inline route marker and original operation in account-scoped recovery caches',()=>{
  const client=new QueryClient();
  retainChapaOriginalAttempt(client,'account-one','topup',intent,key);
  retainPaymentRetryDraft(client,'account-one',key,intent);
  const original=readChapaOriginalAttempt(client,'account-one','topup'),draft=readPaymentRetryDraft(client,'account-one',key);
  expect(original?.intent).toEqual(intent);expect(original?.orderId).toBe(key);expect(chapaOriginalKeyUrl(original?.intent)).toBe('/api/payments/chapa/inline?key='+key);
  expect(draft).toEqual(intent);expect(readChapaOriginalAttempt(client,'account-two','topup')).toBeNull();expect(readPaymentRetryDraft(client,'account-two',key)).toBeNull();
  client.clear();
 });
 it('recognizes only the new v2 Inline marker as API-managed authorization',()=>{
  expect(chapaApiCharge(order)).toBe(true);expect(chapaCurrentInline(order)).toBe(true);
  expect(chapaApiCharge({...order,apiVersion:'legacy',unsupportedLegacy:true,flowVersion:3})).toBe(false);
  expect(chapaApiCharge({...order,flowVersion:3})).toBe(false);
  expect(chapaApiCharge({...order,flowVersion:undefined})).toBe(false);
  expect(chapaApiCharge({...order,chargeType:'HOSTED'})).toBe(false);
  expect(chapaApiCharge({...order,chargeType:'DIRECT',flowVersion:2})).toBe(true);
 });
 it.each(['USSD','OTP'] as const)('keeps accepted %s authorization during transport problems and beyond 90 seconds',authType=>{
  const accepted={...order,authType,verificationState:'UNAVAILABLE'};
  expect(chapaAwaitingAuthorization(accepted)).toBe(true);
  expect(bidPaymentProgressPhase({...progress,order:accepted,paused:true,error:'offline',now:created+900000})).toBe('authorization');
  expect(chapaPaymentPhase({order:accepted,opening:false,restoring:false,paused:true,error:'offline',now:created+900000})).toBe('authorization');
  expect(chapaLongWait(accepted,created+900000)).toBe(false);
  expect(bidPaymentCanRetry(accepted)).toBe(false);
 });
 it('does not invent phone authorization before the server has accepted a reference',()=>{
  const unknown={...order,status:'PENDING',providerStatus:null,authorizationReference:null,authType:null,verificationState:'UNAVAILABLE'};
  expect(chapaAwaitingAuthorization(unknown)).toBe(false);
  expect(bidPaymentProgressPhase({...progress,order:unknown,error:'timeout'})).toBe('uncertain');
  expect(bidPaymentCanRetryOriginal(unknown)).toBe(true);
  expect(bidPaymentCanRetry(unknown)).toBe(false);
  expect(bidPaymentCanRetryOriginal({...unknown,apiVersion:'legacy',unsupportedLegacy:true,flowVersion:3})).toBe(false);
 });
 it('lets verified cancellation, success and security mismatch outrank authorization hints',()=>{
  const cancelled={...order,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED'};
  expect(chapaAwaitingAuthorization(cancelled)).toBe(false);expect(bidPaymentProgressPhase({...progress,order:cancelled})).toBe('terminal');
  expect(bidPaymentCanRetry(cancelled)).toBe(true);expect(bidPaymentCanRetryOriginal(cancelled)).toBe(false);
  expect(bidPaymentProgressPhase({...progress,order:{...order,providerStatus:'SUCCESS'}})).toBe('confirming');
  expect(bidPaymentProgressPhase({...progress,order:{...order,status:'CREDITED',providerStatus:'SUCCESS'}})).toBe('success');
  const mismatch={...order,verificationState:'MISMATCH'};expect(chapaAwaitingAuthorization(mismatch)).toBe(false);expect(bidPaymentProgressPhase({...progress,order:mismatch})).toBe('uncertain');expect(bidPaymentCanRetry(mismatch)).toBe(false);
 });
 it('permits a corrected new attempt only after explicit initialization rejection without accepted authorization',()=>{
  const rejected={...order,status:'NEEDS_REVIEW',reason:'INITIALIZATION_REJECTED',providerStatus:null,authorizationReference:null,initializationIssue:'request' as const,verificationState:'UNAVAILABLE'};
  expect(chapaDirectRequestRejected(rejected)).toBe(true);expect(bidPaymentCanRetry(rejected)).toBe(true);
  expect(chapaDirectRequestRejected({...rejected,authorizationReference:'CH-accepted'})).toBe(false);
  expect(chapaDirectRequestRejected({...rejected,apiVersion:'legacy',unsupportedLegacy:true,flowVersion:3})).toBe(false);
 });
 it('uses provider expiry for new Inline/hosted tracking while preserving older hosted polling bounds',()=>{
  expect(chapaPollingDeadline(order)).toBe(created+5*60000);
  expect(chapaPollingPaused(order,created+86400000)).toBe(false);
  const hosted={...order,chargeType:'HOSTED' as const,expiresAt:new Date(created+86400000).toISOString()};
  expect(chapaPollingDeadline(hosted)).toBe(created+86400000);
  expect(chapaPollingDeadline({...hosted,flowVersion:1})).toBe(created+5*60000);
 });
});
