import {QueryClient} from '@tanstack/react-query';
import {describe,expect,it} from 'vitest';
import {clearHostedChapaAttempt,readHostedChapaAttempt,retainHostedChapaAttempt} from '../src/lib/chapa-hosted-attempt';
import {chapaCheckoutUrl,readChapaAttempt,type ChapaAttempt} from '../src/lib/chapa-client';
import type {BidBatchQuote} from '../src/lib/bid-batch-client';

const id='0f55aaab-2222-4444-8888-123456789012';
const intent={purpose:'BID' as const,key:id,batchId:id,quoteHash:'a'.repeat(64)};
const attempt:ChapaAttempt={version:1,intent};
const quote:BidBatchQuote={id,quoteHash:intent.quoteHash,auctionSlug:'fixture-auction',feeVersion:1,ruleVersion:'lowest-unique-v4',lines:[{position:0,number:'3.60',grossFee:'10.00',discount:'0.00',netFee:'10.00'}],entryCount:1,total:'10.00',totalCents:'1000',grossTotal:'10.00',discountTotal:'0.00',status:'QUOTED'};
describe('hosted checkout recovery boundaries',()=>{
 it('retains the exact command and quoted numbers before a checkout ID arrives',()=>{
  const client=new QueryClient(),source=structuredClone(quote);
  retainHostedChapaAttempt(client,'alice:session','bid:fixture-auction',attempt,source);
  source.lines[0].number='99.00';
  expect(readHostedChapaAttempt(client,'alice:session','bid:fixture-auction')).toEqual({attempt,bidQuote:quote});
  expect(Object.isFrozen(readHostedChapaAttempt(client,'alice:session','bid:fixture-auction')!.attempt.intent)).toBe(true);
  expect(readHostedChapaAttempt(client,'bob:session','bid:fixture-auction')).toBeNull();
  expect(readHostedChapaAttempt(client,'alice:session','bid:another-auction')).toBeNull();
  client.clear();
 });
 it('attaches the original ID without losing its quote and rejects a stale clear',()=>{
  const client=new QueryClient();
  retainHostedChapaAttempt(client,'alice:session','bid:fixture-auction',attempt,quote);
  retainHostedChapaAttempt(client,'alice:session','bid:fixture-auction',{...attempt,orderId:id});
  expect(readHostedChapaAttempt(client,'alice:session','bid:fixture-auction')).toEqual({attempt:{...attempt,orderId:id},bidQuote:quote});
  clearHostedChapaAttempt(client,'alice:session','bid:fixture-auction',{intentKey:'another-key'});
  expect(readHostedChapaAttempt(client,'alice:session','bid:fixture-auction')).not.toBeNull();
  clearHostedChapaAttempt(client,'alice:session','bid:fixture-auction',{orderId:id});
  expect(readHostedChapaAttempt(client,'alice:session','bid:fixture-auction')).toBeNull();
  client.clear();
 });
 it('validates persisted batch command shapes rather than accepting coercible or injected fields',()=>{
  const storage=(value:unknown)=>({getItem:()=>JSON.stringify(value),setItem(){},removeItem(){}});
  expect(readChapaAttempt(storage(attempt),'key')).toEqual(attempt);
  for(const patch of [{batchId:[id]},{quoteHash:['a'.repeat(64)]},{amount:'0.01'},{phone:'0911111111'},{quoteHash:'wrong'}])expect(readChapaAttempt(storage({...attempt,intent:{...intent,...patch}}),'key')).toBeNull();
 });
 it('accepts exact official v1 checkout hosts while retaining the historical v2 origin',()=>{
  expect(chapaCheckoutUrl('https://checkout.chapa.co/checkout/payment/v1-fixture',1)).toBe('https://checkout.chapa.co/checkout/payment/v1-fixture');
  expect(chapaCheckoutUrl('https://checkout.chapa.global/CH-old-payment',2)).toBe('https://checkout.chapa.global/CH-old-payment');
  expect(chapaCheckoutUrl('https://checkout.chapa.global/checkout/payment/v1-fixture',1)).toBe('https://checkout.chapa.global/checkout/payment/v1-fixture');
  expect(chapaCheckoutUrl('https://checkout.chapa.co/checkout/payment/v1-fixture',2)).toBeNull();
  for(const value of ['https://checkout.chapa.co.evil.test/a','https://user:pass@checkout.chapa.co/a','http://checkout.chapa.co/a','https://checkout.chapa.co:8443/a','https://checkout.chapa.co/a#result=success'])expect(chapaCheckoutUrl(value,1)).toBeNull();
 });
});
