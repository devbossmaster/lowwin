import {afterEach,describe,expect,it,vi} from 'vitest';
import {chapaStatusLabel} from '../src/components/chapa-payment';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const pending=(createdAt:number)=>({purpose:'TOP_UP',status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',reason:null,fundsPreserved:false,receipt:null,createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(createdAt+86400000).toISOString()}) as ChapaCheckoutView;
afterEach(()=>vi.useRealTimers());

describe('saved transaction labels follow authoritative outcomes',()=>{
 it('does not relabel pending history after five minutes or the recorded checkout validity',()=>{
  vi.useFakeTimers();const now=Date.now(),order=pending(now),original=structuredClone(order);
  expect(chapaStatusLabel(order)).toBe('Waiting for confirmation');
  vi.setSystemTime(now+300001);expect(chapaStatusLabel(order)).toBe('Waiting for confirmation');
  vi.setSystemTime(now+86400001);expect(chapaStatusLabel(order)).toBe('Waiting for confirmation');
  expect(order).toEqual(original);
 });
 it('shows confirmed Chapa failures, cancellation and incomplete outcomes without guessing',()=>{
  const order=pending(Date.now()-86400001);
  for(const [status,label] of [['FAILED','Payment failed'],['CANCELLED','Payment cancelled'],['INCOMPLETE','Authorization not completed'],['BLOCKED','Payment blocked']] as const){
   expect(chapaStatusLabel({...order,status,providerStatus:status})).toBe(label);
  }
  expect(chapaStatusLabel({...order,status:'CREDITED',providerStatus:'SUCCESS'})).toBe('Wallet credited');
 });
 it('keeps verification errors and mismatches explicit even on old pending checkouts',()=>{
  const order=pending(Date.now()-86400001);
  expect(chapaStatusLabel({...order,verificationState:'UNAVAILABLE'})).toBe('Checking original payment');
  expect(chapaStatusLabel({...order,verificationState:'MISMATCH'})).toBe('Needs verification');
 });
 it('distinguishes local display expiry from provider expiry and preserves a verified outcome during a later lookup outage',()=>{
  const order=pending(Date.now()-86400001);
  expect(chapaStatusLabel({...order,status:'EXPIRED',providerStatus:'PENDING'})).toBe('Checking original payment');
  expect(chapaStatusLabel({...order,status:'EXPIRED',providerStatus:'EXPIRED'})).toBe('Authorization expired');
  expect(chapaStatusLabel({...order,status:'CANCELLED',providerStatus:'CANCELLED',verificationUnavailable:true})).toBe('Payment cancelled');
 });
});
