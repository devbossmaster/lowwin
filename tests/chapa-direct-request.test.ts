import {describe,expect,it} from 'vitest';
import {ChapaClientError} from '../src/lib/chapa-client';
import {chapaDirectCreationRejected} from '../src/lib/chapa-direct-request';

describe('direct checkout creation rejection',()=>{
 it('allows an expired or consumed coupon to be reviewed after its known precreation rejection',()=>{
  expect(chapaDirectCreationRejected(new ChapaClientError('Coupon expired.',409,'COUPON_UNAVAILABLE'))).toBe(true);
 });
 it('preserves the existing explicit creation rejection codes',()=>{
  for(const [status,code] of [[409,'TERMS_CHANGED'],[422,'INVALID_PHONE'],[422,'METHOD_UNAVAILABLE'],[409,'PAYMENT_STARTED'],[409,'CONTACT_REQUIRED'],[503,'AUCTIONS_PAUSED']] as const){
   expect(chapaDirectCreationRejected(new ChapaClientError('Rejected.',status,code))).toBe(true);
  }
 });
 it('releases a changed deposit bonus quote rejected before provider dispatch',()=>{
  expect(chapaDirectCreationRejected(new ChapaClientError('Review the new bonus.',409,'DEPOSIT_BONUS_CHANGED'))).toBe(true);
  expect(chapaDirectCreationRejected(new ChapaClientError('Unknown response.',503,'DEPOSIT_BONUS_CHANGED'))).toBe(false);
 });
 it('retains an ambiguous request after a timeout, outage or unclassified conflict',()=>{
  for(const cause of [new DOMException('Timed out.','AbortError'),new Error('Connection lost.'),new ChapaClientError('Unavailable.',503,'PAYMENT_UNAVAILABLE'),new ChapaClientError('Unavailable.',503,'COUPON_UNAVAILABLE'),new ChapaClientError('Conflict.',409,'RETRYABLE_CONFLICT'),new ChapaClientError('Conflict.',409,'KEY_REUSED')]){
   expect(chapaDirectCreationRejected(cause)).toBe(false);
  }
 });
 it('does not classify unproven quote codes or untyped responses as creation rejection',()=>{
  for(const cause of [new ChapaClientError('Stale.',409,'STALE_QUOTE'),new ChapaClientError('Changed.',409,'QUOTE_CHANGED'),{status:409,code:'COUPON_UNAVAILABLE'}]){
   expect(chapaDirectCreationRejected(cause)).toBe(false);
  }
 });
});
