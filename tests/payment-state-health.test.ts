import {describe,it,expect} from 'vitest';
import {bidPaymentCanRetry,bidPaymentConnectionDelayed,bidPaymentProgressPhase} from '../src/lib/bid-payment-progress';
import {acceptChapaSnapshot,chapaAwaitingAuthorization,type ChapaCheckoutView} from '../src/lib/chapa-client';
import {chapaLongWait,chapaPaymentPhase} from '../src/lib/chapa-status';
const created=Date.parse('2026-11-10T10:00:00Z');
const order={id:'owned-original',purpose:'TOP_UP',chargeType:'DIRECT',status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',authorizationReference:'accepted-reference',authType:'USSD',amount:'35.00',createdAt:new Date(created).toISOString(),expiresAt:new Date(created+300000).toISOString(),fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const state={order,busy:false,restoring:false,opening:false,paused:false,error:'',now:created};
describe('accepted payment state is independent of checking health',()=>{
 it.each(['BID','TOP_UP'] as const)('keeps %s authorization through transient errors, 90 seconds and foreground polling pause',purpose=>{
  for(const extra of [{error:'Temporary verification error',errorCode:'UNAVAILABLE'},{order:{...order,purpose,verificationState:'UNAVAILABLE'}},{order:{...order,purpose,verificationUnavailable:true}},{paused:true,now:created+900000},{now:created+90001}]){
   const snapshot={...state,order:{...order,purpose},...extra};
   expect(bidPaymentProgressPhase(snapshot)).toBe('authorization');expect(chapaPaymentPhase(snapshot)).toBe('authorization');expect(bidPaymentConnectionDelayed(snapshot)).toBe(true);expect(bidPaymentCanRetry(snapshot.order)).toBe(false);
  }
  expect(chapaLongWait({...order,purpose},created+900000)).toBe(false);
 });
 it('requires an accepted reference and refuses to turn local expiry into a failed payment',()=>{
  expect(chapaAwaitingAuthorization({...order,authorizationReference:null})).toBe(false);
  expect(bidPaymentProgressPhase({...state,now:created+300001})).toBe('authorization');
  expect(bidPaymentCanRetry({...order,status:'EXPIRED',providerStatus:null})).toBe(false);
  expect(bidPaymentCanRetry({...order,status:'FAILED',providerStatus:'FAILED',verificationState:'UNAVAILABLE'})).toBe(false);
 });
 it('never masks a genuine mismatch, verified terminal outcome or late verified success',()=>{
  expect(bidPaymentProgressPhase({...state,order:{...order,verificationState:'MISMATCH'},error:'offline'})).toBe('uncertain');
  for(const status of ['FAILED','CANCELLED','INCOMPLETE','BLOCKED','EXPIRED','FAILED_OR_CANCELLED']){
   const terminal={...order,status,providerStatus:status,verificationState:'VERIFIED'};expect(chapaAwaitingAuthorization(terminal)).toBe(false);expect(bidPaymentProgressPhase({...state,order:terminal})).toBe('terminal');expect(bidPaymentCanRetry(terminal)).toBe(true);
  }
  const received={...order,providerStatus:'SUCCESS',verificationState:'VERIFIED'};expect(bidPaymentProgressPhase({...state,order:received,error:'old error'})).toBe('confirming');
  expect(bidPaymentProgressPhase({...state,order:{...received,status:'CREDITED'},error:'old error'})).toBe('success');
 });
 it('will not replace security or terminal evidence with a newer transport-health response, but accepts late credit',()=>{
  const mismatch={...order,verificationState:'MISMATCH',status:'NEEDS_REVIEW'};
  expect(acceptChapaSnapshot(mismatch,{...order,verificationState:'UNAVAILABLE',updatedAt:new Date(created+90000).toISOString()})).toBe(false);
  const cancelled={...order,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED'};
  expect(acceptChapaSnapshot(cancelled,{...order,verificationState:'UNAVAILABLE'})).toBe(false);
  expect(acceptChapaSnapshot(cancelled,{...order,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'})).toBe(true);
 });
});
