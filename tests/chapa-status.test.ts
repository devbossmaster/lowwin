import {describe,expect,it} from 'vitest';
import {chapaPaymentPhase} from '../src/lib/chapa-status';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const pending={purpose:'TOP_UP',status:'PENDING',providerStatus:'PENDING',verificationState:'UNVERIFIED',fundsPreserved:false,receipt:null} as ChapaCheckoutView;
const state={order:pending,opening:false,restoring:false,paused:false,error:''};
describe('payment modal states follow server evidence',()=>{
 it('keeps redirects and provider success separate from applied Lowwin credit',()=>{
  expect(chapaPaymentPhase(state)).toBe('confirming');
  expect(chapaPaymentPhase({...state,order:{...pending,providerStatus:'SUCCESS'}})).toBe('applying');
  expect(chapaPaymentPhase({...state,order:{...pending,status:'CREDITED'},error:'stale error',opening:true})).toBe('confirmed');
 });
 it('never hides a mismatch or unavailable verification behind an endless spinner',()=>{
  expect(chapaPaymentPhase({...state,order:null,error:'Connection interrupted'})).toBe('interrupted');
  expect(chapaPaymentPhase({...state,order:{...pending,status:'NEEDS_REVIEW',verificationState:'MISMATCH'}})).toBe('review');
  expect(chapaPaymentPhase({...state,order:{...pending,verificationState:'UNAVAILABLE'}})).toBe('unavailable');
  expect(chapaPaymentPhase({...state,paused:true})).toBe('pending');
  expect(chapaPaymentPhase({...state,paused:true,error:'offline',order:{...pending,verificationState:'UNAVAILABLE'}})).toBe('pending');
  expect(chapaPaymentPhase({...state,error:'configuration',errorCode:'CONFIGURATION_CHANGED'})).toBe('review');
  expect(chapaPaymentPhase({...state,error:'not owned',errorCode:'NOT_FOUND'})).toBe('access');
 });
 it('requires a bid receipt, preserves late-payment funds and honors provider failures',()=>{
  expect(chapaPaymentPhase({...state,order:{...pending,purpose:'BID',status:'BID_ACCEPTED'}})).not.toBe('confirmed');
  expect(chapaPaymentPhase({...state,order:{...pending,purpose:'BID',status:'NEEDS_REVIEW',fundsPreserved:true}})).toBe('preserved');
  for(const status of ['FAILED','CANCELLED','BLOCKED','INCOMPLETE'])expect(chapaPaymentPhase({...state,order:{...pending,status}})).toBe('failed');
 });
});
