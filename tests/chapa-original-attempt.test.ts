import {describe,expect,it} from 'vitest';
import {SessionPrivateQueryCache} from '../src/components/private-query-cache';
import {clearChapaOriginalAttempt,readChapaOriginalAttempt,retainChapaOriginalAttempt} from '../src/lib/chapa-original-attempt';

const intent={key:'a2345678-1234-4234-8234-123456789012',purpose:'TOP_UP' as const,amount:'250.00',paymentMethod:'telebirr',phone:'251911000001'};
describe('tab-scoped original top-up command',()=>{
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
});
