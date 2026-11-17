import {describe,expect,it} from 'vitest';
import {acceptChapaSnapshot,chapaAwaitingAuthorization,chapaCanResumeCheckout,chapaConfirmed,chapaDirectRequestRejected,chapaRecoverable,chapaVerifiedTerminal,type ChapaCheckoutView} from '../src/lib/chapa-client';
import {bidPaymentAuthorizationError,bidPaymentCanRetry,bidPaymentCanRetryOriginal,bidPaymentProgressPhase} from '../src/lib/bid-payment-progress';
import {chapaPaymentPhase} from '../src/lib/chapa-status';
import {chapaStatusLabel} from '../src/lib/chapa-status-label';
import {chapaPaymentReasonMessage} from '../src/lib/chapa-payment-reason';
import {paymentSummaryState} from '../src/lib/payment-summary';

const current=(patch:Partial<ChapaCheckoutView>={})=>({id:'owned-original',purpose:'TOP_UP',apiVersion:'v2',flowVersion:4,chargeType:'INLINE',status:'NEEDS_REVIEW',providerStatus:'FAILED',verificationState:'VERIFIED',completionSignalPending:true,providerReasonCode:'INVALID_PIN',reason:'CHAPA_INVALID_PIN',authorizationReference:'CHowned',authType:'OTP',authorizationReasonCode:'INVALID_OTP',amount:'40.00',createdAt:'2026-11-17T10:00:00Z',updatedAt:'2026-11-17T10:01:00Z',expiresAt:'2026-11-17T10:05:00Z',fundsPreserved:false,receipt:null,...patch}) as ChapaCheckoutView;
const phase=(order:ChapaCheckoutView)=>bidPaymentProgressPhase({order,busy:false,restoring:false,paused:false,error:''});

describe('retained completion hints preserve original-attempt presentation',()=>{
 it.each(['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'])('keeps contradictory private %s checking until the server resolves the retained generation',providerStatus=>{
  const order=current({status:providerStatus,providerStatus});
  expect(chapaVerifiedTerminal(order)).toBe(false);expect(chapaRecoverable(order)).toBe(true);
  expect(bidPaymentCanRetry(order)).toBe(false);expect(bidPaymentCanRetryOriginal(order)).toBe(false);
  expect(phase(order)).toBe('confirming');expect(chapaPaymentPhase({order,opening:false,restoring:false,paused:false,error:'offline'})).toBe('confirming');
  expect(chapaStatusLabel(order)).toBe('Checking original payment');expect(chapaPaymentReasonMessage(order)).toBeNull();
  expect(paymentSummaryState({completed:false,providerStatus,verificationState:'VERIFIED',completionSignalPending:true})).toBe('checking');
 });
 it('does not request another OTP or replay initialization while a terminal signal needs reconciliation',()=>{
  const order=current({status:'PENDING',providerStatus:'PENDING'});
  expect(chapaAwaitingAuthorization(order)).toBe(false);expect(bidPaymentAuthorizationError(order)).toBeNull();expect(phase(order)).toBe('confirming');
  const initializing={...order,authorizationReference:null,reason:'INITIALIZATION_REJECTED',initializationIssue:'request' as const,initializationReasonCode:'INSUFFICIENT_FUNDS'};
  expect(chapaDirectRequestRejected(initializing)).toBe(false);expect(bidPaymentCanRetryOriginal(initializing)).toBe(false);
  expect(chapaCanResumeCheckout({version:1,intent:{key:'8d845028-bb7a-4cce-bca6-510bb149ed01',purpose:'TOP_UP',amount:'40.00'}},initializing)).toBe(false);
 });
 it.each([
  {purpose:'TOP_UP' as const,status:'CREDITED',providerStatus:'SUCCESS'},
  {purpose:'BID' as const,status:'BID_ACCEPTED',providerStatus:'SUCCESS',receipt:{bid:{id:'accepted'}} as ChapaCheckoutView['receipt']},
  {purpose:'BID' as const,status:'NEEDS_REVIEW',providerStatus:'SUCCESS',fundsPreserved:true},
 ])('keeps committed $status above stale completion metadata',patch=>{
  const order=current(patch);expect(chapaConfirmed(order)).toBe(true);expect(phase(order)).toBe(order.fundsPreserved?'preserved':'success');
  expect(paymentSummaryState({completed:true,providerStatus:order.providerStatus,verificationState:'VERIFIED',completionSignalPending:true})).toBe('done');
 });
 it('retains compatibility when the optional marker is absent and allows a freshly reconciled terminal retry',()=>{
  for(const completionSignalPending of [undefined,false]){
   const order=current({status:'FAILED',completionSignalPending});expect(chapaVerifiedTerminal(order)).toBe(true);expect(bidPaymentCanRetry(order)).toBe(true);expect(phase(order)).toBe('terminal');
  }
 });
 it('accepts a newer retained signal after an earlier terminal read and its later private resolution, without accepting stale frames over committed success',()=>{
  const failed=current({status:'FAILED',completionSignalPending:false,updatedAt:'2026-11-17T10:00:00Z'}),signal=current(),resolved=current({status:'FAILED',completionSignalPending:false,updatedAt:'2026-11-17T10:02:00Z'});
  expect(acceptChapaSnapshot(failed,signal)).toBe(true);expect(acceptChapaSnapshot(signal,resolved)).toBe(true);expect(acceptChapaSnapshot(resolved,signal)).toBe(false);
  const committed=current({status:'CREDITED',providerStatus:'SUCCESS',updatedAt:'2026-11-17T10:02:00Z'});
  expect(acceptChapaSnapshot(committed,{...signal,updatedAt:'2026-11-17T10:03:00Z'})).toBe(false);
 });
});
