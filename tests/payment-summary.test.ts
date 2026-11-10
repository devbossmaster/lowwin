import {describe,expect,it} from 'vitest';
import {paymentSummaryLabel,paymentSummaryState} from '../src/lib/payment-summary';

describe('ordinary payment summaries',()=>{
 it.each(['PENDING','SUCCESS',null,undefined])('keeps uncommitted %s evidence checking',providerStatus=>{
  expect(paymentSummaryState({completed:false,providerStatus,verificationState:'VERIFIED'})).toBe('checking');
 });
 it.each(['FAILED','CANCELLED','EXPIRED','INCOMPLETE','BLOCKED','FAILED_OR_CANCELLED'])('requires verified provider evidence for %s',providerStatus=>{
  expect(paymentSummaryState({completed:false,providerStatus,verificationState:'UNVERIFIED'})).toBe('checking');
  expect(paymentSummaryState({completed:false,providerStatus,verificationState:'VERIFIED'})).toBe('failed');
 });
 it('keeps committed money done despite stale or conflicting delivery evidence',()=>{
  expect(paymentSummaryState({completed:true,providerStatus:'FAILED',verificationState:'MISMATCH'})).toBe('done');
 });
 it('uses concise localized copy without suggesting an accepted bid',()=>{
  expect(paymentSummaryLabel('done')).toBe('Done');
  expect(paymentSummaryLabel('checking')).toBe('Checking payment…');
  expect(paymentSummaryLabel('failed',true)).toBe('አልተሳካም');
 });
});
