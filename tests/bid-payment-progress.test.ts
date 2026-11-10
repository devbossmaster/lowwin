import {describe,expect,it} from 'vitest';
import {bidPaymentApplicationDelayed,bidPaymentCanRetry,bidPaymentCanRetryOriginal,bidPaymentProgressPhase,maskedBidPaymentPhone} from '@/lib/bid-payment-progress';
import type {ChapaCheckoutView} from '@/lib/chapa-client';

const created=Date.parse('2026-11-10T10:00:00Z');
const pending={id:'payment-id',purpose:'BID',chargeType:'DIRECT',status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',createdAt:new Date(created).toISOString(),expiresAt:new Date(created+60000).toISOString(),fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const state={order:pending,busy:false,restoring:false,paused:false,error:'',now:created};

describe('bid-only progress follows the owned payment outcome',()=>{
 it('returns to checkout only for an explicit persisted initialization rejection, not an ambiguous historical request',()=>{
  const rejected={...pending,status:'NEEDS_REVIEW',reason:'INITIALIZATION_REJECTED',providerStatus:null,authorizationReference:null,initializationIssue:'request' as const,verificationState:'UNAVAILABLE'};
  expect(bidPaymentCanRetry(rejected)).toBe(true);
  expect(bidPaymentProgressPhase({...state,order:rejected})).toBe('terminal');
  expect(bidPaymentCanRetry({...rejected,status:'PENDING',reason:'PROVIDER_CONFIRMATION_REQUIRED'})).toBe(false);
  expect(bidPaymentCanRetry({...rejected,authorizationReference:'accepted-request'})).toBe(false);
  expect(bidPaymentCanRetry({...rejected,providerStatus:'SUCCESS'})).toBe(false);
  expect(bidPaymentCanRetry({...rejected,verificationState:'MISMATCH'})).toBe(false);
 });
 it('offers a new entry only for terminal outcomes, never success, mismatch, review or a client deadline',()=>{
  for(const status of ['FAILED','CANCELLED','INCOMPLETE','BLOCKED']){
   const order={...pending,status,providerStatus:status};
   expect(bidPaymentCanRetry(order)).toBe(true);
   expect(bidPaymentProgressPhase({...state,order})).toBe('terminal');
   expect(bidPaymentCanRetry({...order,verificationState:'MISMATCH'})).toBe(false);
   expect(bidPaymentCanRetry({...order,providerStatus:'SUCCESS'})).toBe(false);
  }
  expect(bidPaymentCanRetry({...pending,status:'NEEDS_REVIEW'})).toBe(false);
  expect(bidPaymentCanRetry(pending)).toBe(false);
  expect(bidPaymentProgressPhase({...state,now:created+300000})).toBe('uncertain');
  expect(pending.status).toBe('PENDING');
 });
 it('requires confirmed expiry evidence and does not turn an elapsed expiresAt into a failure',()=>{
  expect(bidPaymentProgressPhase({...state,now:created+61000})).not.toBe('terminal');
  expect(bidPaymentCanRetry({...pending,status:'EXPIRED'})).toBe(false);
  expect(bidPaymentCanRetry({...pending,status:'EXPIRED',providerStatus:'EXPIRED',verificationState:'UNAVAILABLE'})).toBe(false);
  expect(bidPaymentCanRetry({...pending,status:'EXPIRED',providerStatus:'EXPIRED'})).toBe(true);
 });
 it('waits for committed bid evidence after provider success, and distinguishes preserved funds',()=>{
  expect(bidPaymentProgressPhase({...state,order:{...pending,providerStatus:'SUCCESS'}})).toBe('confirming');
  expect(bidPaymentProgressPhase({...state,order:{...pending,status:'BID_ACCEPTED',providerStatus:'SUCCESS'}})).toBe('uncertain');
  expect(bidPaymentProgressPhase({...state,order:{...pending,status:'BID_ACCEPTED',receipt:{bid:{id:'accepted'}} as ChapaCheckoutView['receipt']}})).toBe('success');
  expect(bidPaymentProgressPhase({...state,order:{...pending,status:'NEEDS_REVIEW',fundsPreserved:true}})).toBe('preserved');
  expect(bidPaymentProgressPhase({...state,hasReceipt:true,error:'stale connection error'})).toBe('success');
 });
 it('keeps OTP authorization available for invalid codes and paused polling, but checks unknown authorization errors first',()=>{
  const order={...pending,status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',authType:'OTP' as const,authorizationReference:'original-reference'};
  expect(bidPaymentProgressPhase({...state,order,paused:true,now:created+900000})).toBe('authorization');
  expect(bidPaymentProgressPhase({...state,order,error:'Invalid code',errorCode:'INVALID_OTP'})).toBe('authorization');
  expect(bidPaymentProgressPhase({...state,order,error:'Connection interrupted',errorCode:'UNAVAILABLE'})).toBe('uncertain');
  expect(bidPaymentProgressPhase({...state,order:{...order,authType:'USSD'},now:created+90000})).toBe('uncertain');
 });
 it('does not present a phone prompt for an unaccepted or interrupted initialization',()=>{
  expect(bidPaymentProgressPhase({...state,order:null,preparing:true})).toBe('preparing');
  expect(bidPaymentProgressPhase({...state,order:null,started:true,preparing:true,busy:true})).toBe('connecting');
  expect(bidPaymentProgressPhase({...state,order:null,error:'timeout'})).toBe('uncertain');
  expect(bidPaymentProgressPhase({...state,order:null,walletRetry:true})).toBe('uncertain');
  expect(bidPaymentProgressPhase({...state,order:{...pending,providerStatus:null,initializationIssue:'request'}})).toBe('uncertain');
  const interrupted={...pending,status:'SUBMITTING',verificationState:'UNAVAILABLE'};
  expect(bidPaymentProgressPhase({...state,order:interrupted,busy:true})).toBe('connecting');
  expect(bidPaymentProgressPhase({...state,order:interrupted,busy:false})).toBe('uncertain');
 });
 it('recovers the same direct intent with or without an owned order ID, never replaying accepted or conflicting initialization',()=>{
  expect(bidPaymentCanRetryOriginal(null)).toBe(true);
  for(const status of ['SUBMITTING','PENDING'])expect(bidPaymentCanRetryOriginal({...pending,status,authorizationReference:null,verificationState:'UNAVAILABLE',initializationIssue:'temporary'})).toBe(true);
  for(const status of ['AUTH_NEEDED','NEEDS_REVIEW','FAILED','CANCELLED','INCOMPLETE','BLOCKED','EXPIRED','BID_ACCEPTED'])expect(bidPaymentCanRetryOriginal({...pending,status})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,authorizationReference:'accepted-reference'})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,providerStatus:'SUCCESS'})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,verificationState:'MISMATCH'})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,initializationIssue:'state'})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,providerStatus:null,initializationIssue:'request'})).toBe(false);
  expect(bidPaymentCanRetryOriginal({...pending,chargeType:'HOSTED'})).toBe(false);
 });
 it('masks full and already masked phones without relaying arbitrary strings',()=>{
  for(const phone of ['0912345678','+251912345678','912345678'])expect(maskedBidPaymentPhone(phone)).toBe('+251 ••• •• 5678');
  expect(maskedBidPaymentPhone('+2519*****678')).toBe('+251 ••• •• 678');
  expect(maskedBidPaymentPhone('<script>provider error</script>')).toBeNull();
  expect(maskedBidPaymentPhone(null)).toBeNull();
 });
 it('quiets a provider success after the existing display deadline while still waiting for a committed receipt',()=>{
  for(const status of ['PENDING','VERIFYING']){
   const order={...pending,status,providerStatus:'SUCCESS'};
   expect(bidPaymentApplicationDelayed(order,false,created+89999)).toBe(false);
   expect(bidPaymentApplicationDelayed(order,false,created+90000)).toBe(true);
   expect(bidPaymentApplicationDelayed(order,true,created)).toBe(true);
   expect(bidPaymentProgressPhase({...state,order,now:created+90000})).toBe('confirming');
   expect(bidPaymentCanRetry(order)).toBe(false);
  }
  expect(bidPaymentApplicationDelayed(pending,false,created+90000)).toBe(false);
  expect(bidPaymentApplicationDelayed({...pending,status:'BID_ACCEPTED',providerStatus:'SUCCESS',receipt:{bid:{id:'accepted'}} as ChapaCheckoutView['receipt']},true,created+90000)).toBe(false);
 });
});
