import {describe,expect,it} from 'vitest';
import {SessionPrivateQueryCache} from '../src/components/private-query-cache';
import {clearChapaOriginalAttempt,clearSettledChapaOriginalAttempt,readChapaOriginalAttempt,retainChapaOriginalAttempt} from '../src/lib/chapa-original-attempt';
import type {BidBatchQuote} from '../src/lib/bid-batch-client';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const intent={key:'a2345678-1234-4234-8234-123456789012',purpose:'TOP_UP' as const,amount:'250.00',paymentMethod:'telebirr',phone:'251911000001'};
describe('tab-scoped original top-up command',()=>{
 it('retains the reviewed bid total and numbers before a response supplies an order ID',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');const bid={key:intent.key,purpose:'BID' as const,batchId:'immutable-batch',quoteHash:'reviewed-hash',paymentMethod:'mpesa',phone:'251713339196'},quote={id:'immutable-batch',auctionSlug:'owned-auction',lines:[{number:'4.25'},{number:'8.00'}],total:'100.00'} as BidBatchQuote;
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction',bid,undefined,quote);
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction',bid);
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction')).toEqual({intent:bid,bidQuote:quote});
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction',bid,'owned-order');expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction')).toEqual({intent:bid,bidQuote:quote,orderId:'owned-order'});
 });
 it('retains the original bid operation per auction and freezes its selected numbers',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');const numbers=['2.00','4.25'];
  const bid={key:intent.key,purpose:'BID' as const,auctionSlug:'owned-auction',numbers,feeVersion:1,paymentMethod:'telebirr',phone:intent.phone,approvedTotal:'20.00'};
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction',bid,'owned-bid-order');numbers.push('8.00');
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction')).toEqual({intent:{...bid,numbers:['2.00','4.25']},orderId:'owned-bid-order'});
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','bid:other-auction')).toBeNull();cache.setIdentity(null);expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','bid:owned-auction')).toBeNull();
 });
 it('retains the frozen original key and fields when a sheet unmounts or display data invalidates',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  const draft={...intent};retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',draft);
  draft.amount='900.00';cache.invalidate('owner:session',['/api/wallet','/api/payments/chapa/checkouts']);
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toEqual({intent});
  expect(Object.isFrozen(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')!.intent)).toBe(true);
  expect(cache.queryClient.getQueryCache().getAll()).toHaveLength(1);
 });
 it('preserves one owned order identifier without storing a paid result or issuing a request',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent,'b2345678-1234-4234-8234-123456789012');
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toEqual({intent,orderId:'b2345678-1234-4234-8234-123456789012'});
  expect(cache.queryClient.isFetching()).toBe(0);
  expect(readChapaOriginalAttempt(cache.queryClient,'other:session','topup')).toBeNull();
 });
 it('clears private commands on logout and account change',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent);cache.setIdentity('other:session');
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toBeNull();
  retainChapaOriginalAttempt(cache.queryClient,'other:session','topup',{...intent,key:'c2345678-1234-4234-8234-123456789012'});cache.setIdentity(null);
  expect(readChapaOriginalAttempt(cache.queryClient,'other:session','topup')).toBeNull();
 });
 it('clears on authorization failure and does not clear another frozen attempt',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent);
  clearChapaOriginalAttempt(cache.queryClient,'owner:session','topup',{intentKey:'different-attempt'});
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).not.toBeNull();
  cache.authorizationFailure('owner:session');expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toBeNull();
 });
 it('removes only the matched command after a definitive outcome or explicit safe restart',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent,'owned-order');
  clearChapaOriginalAttempt(cache.queryClient,'owner:session','topup',{orderId:'different-order'});expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).not.toBeNull();
  clearChapaOriginalAttempt(cache.queryClient,'owner:session','topup',{orderId:'owned-order'});expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toBeNull();
 });
 it('dismisses only the matching verified terminal attempt without sending any request',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent,'owned-order');
  const cancelled={id:'owned-order',purpose:'TOP_UP',chargeType:'INLINE',apiVersion:'v2',flowVersion:4,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',fundsPreserved:false} as ChapaCheckoutView;
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',cancelled,intent.key)).toBe(true);
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toBeNull();expect(cache.queryClient.isFetching()).toBe(0);
 });
 it('never releases an unresolved, expired display, unverified failure, authorization rejection or mismatch on Close',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  const pending={id:'owned-order',purpose:'TOP_UP',chargeType:'INLINE',apiVersion:'v2',flowVersion:4,status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',fundsPreserved:false} as ChapaCheckoutView;
  for(const order of [null,pending,{...pending,status:'EXPIRED'},{...pending,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'UNAVAILABLE'},{...pending,authorizationReasonCode:'INVALID_PIN'},{...pending,status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'MISMATCH'},{...pending,providerStatus:'SUCCESS'}] as (ChapaCheckoutView|null)[]){
   retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent,'owned-order');
   expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',order,intent.key)).toBe(false);
   expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')).toEqual({intent,orderId:'owned-order'});
  }
 });
 it('does not clear another owned original when a stale closed surface reports a completed payment',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  const credited={id:'old-order',purpose:'TOP_UP',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',fundsPreserved:false} as ChapaCheckoutView;
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',{...intent,key:'another-key'},'new-order');
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',credited,intent.key)).toBe(false);
  expect(readChapaOriginalAttempt(cache.queryClient,'owner:session','topup')?.orderId).toBe('new-order');
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'other:session','topup',{...credited,id:'new-order'},'another-key')).toBe(false);
 });
 it('requires the original key when a completed response arrived without a previously stored order ID',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  const credited={id:'owned-order',purpose:'TOP_UP',status:'CREDITED',fundsPreserved:false} as ChapaCheckoutView;
  retainChapaOriginalAttempt(cache.queryClient,'owner:session','topup',intent);
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',credited)).toBe(false);
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',credited,'another-key')).toBe(false);
  expect(clearSettledChapaOriginalAttempt(cache.queryClient,'owner:session','topup',credited,intent.key)).toBe(true);
 });
});
