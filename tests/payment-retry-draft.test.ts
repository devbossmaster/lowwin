import {afterEach,describe,expect,it,vi} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {readPaymentRetryDraft,retainPaymentRetryDraft} from '../src/lib/payment-retry-draft';
import type {ChapaDirectIntent} from '../src/lib/bid-batch-client';

const clients:QueryClient[]=[];
const client=()=>{const value=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(value);return value};
const intent=(key:string):ChapaDirectIntent=>({key,purpose:'BID',auctionSlug:'fixture-auction',numbers:['2','3'],feeVersion:1,approvedTotal:'20.00',paymentMethod:'telebirr',phone:'+251911000000'});
afterEach(()=>{clients.forEach(value=>value.clear());clients.length=0;vi.useRealTimers()});
describe('editable payment retry drafts',()=>{
 it('keeps the same order ID isolated between accounts and participates in session cache clearing',()=>{
  const cache=client();retainPaymentRetryDraft(cache,'account-a','same-order',intent('first'));retainPaymentRetryDraft(cache,'account-b','same-order',intent('second'));
  expect(readPaymentRetryDraft(cache,'account-a','same-order')?.key).toBe('first');expect(readPaymentRetryDraft(cache,'account-b','same-order')?.key).toBe('second');expect(readPaymentRetryDraft(cache,'unknown','same-order')).toBeNull();
  cache.removeQueries({queryKey:['lowin-private']});expect(readPaymentRetryDraft(cache,'account-a','same-order')).toBeNull();expect(readPaymentRetryDraft(cache,'account-b','same-order')).toBeNull();
 });
 it('copies editable selections without turning subsequent source edits into retry state',()=>{
  const cache=client(),draft=intent('original');retainPaymentRetryDraft(cache,'account','order',draft);
  if(draft.purpose==='BID'&&'numbers'in draft)draft.numbers.push('4');draft.phone='+251922000000';
  expect(readPaymentRetryDraft(cache,'account','order')).toMatchObject({numbers:['2','3'],phone:'+251911000000'});
 });
 it('expires abandoned drafts after ten minutes and keeps only the latest twenty per account',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T10:00:00Z'));const cache=client();
  for(let index=0;index<21;index++){vi.setSystemTime(Date.now()+1);retainPaymentRetryDraft(cache,'account','order-'+index,intent(String(index)))}
  expect(readPaymentRetryDraft(cache,'account','order-0')).toBeNull();expect(readPaymentRetryDraft(cache,'account','order-20')?.key).toBe('20');
  vi.setSystemTime(Date.now()+600001);expect(readPaymentRetryDraft(cache,'account','order-20')).toBeNull();
 });
});
