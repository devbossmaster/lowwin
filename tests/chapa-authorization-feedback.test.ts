import {describe,expect,it,vi} from 'vitest';
import type {ChapaCheckout} from '@prisma/client';
import {chapaAuthorizationErrorFeedback,chapaAuthorizationFeedback} from '../src/modules/payments/chapa-authorization-feedback';
import {ChapaProviderError} from '../src/modules/payments/chapa-provider';
import {chapaRequestReasonMessage,publicChapaAuthorizationReason} from '../src/lib/chapa-payment-reason';

vi.mock('../src/modules/auth/own-contact',()=>({decryptPhone:()=> '251911652904'}));
const owned=(paymentMethod='telebirr')=>({id:'8d845028-bb7a-4cce-bca6-510bb149ed01',authorizationReference:'CHowned',merchantReference:'LWowned',amountCents:4000n,currency:'ETB',paymentMethod,mode:'test',initialization:{},payerPhoneCipher:'encrypted',phoneBotId:'bot'} as ChapaCheckout);
const reply=(status='FAILED',reason:unknown='INSUFFICIENT_BALANCE',patch:Record<string,unknown>={})=>({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status,reason,mode:'test',...patch}});

describe('separate, safely bound Chapa authorization feedback',()=>{
 it.each(['telebirr','cbebirr','mpesa'])('recognizes %s rejection without declaring private payment failure',paymentMethod=>{
  expect(chapaAuthorizationFeedback(reply('FAILED','INSUFFICIENT_BALANCE',{payment_method:paymentMethod}),owned(paymentMethod))).toEqual({kind:'rejected',code:'INSUFFICIENT_FUNDS'});
 });
 it.each([{chapa_reference:'CHother'},{merchant_reference:'LWother'},{amount:4001},{currency:'USD'},{payment_method:'mpesa'},{mode:'live'},{customer:{phone_number:'251911111111'}}])('ignores validation feedback conflicting with the immutable authorization: %j',patch=>{
  expect(chapaAuthorizationFeedback(reply('FAILED','WRONG_PIN',patch),owned())).toBeUndefined();
 });
 it('requires actual financial/reference binding rather than a status-only validation callback',()=>{
  expect(chapaAuthorizationFeedback({status:'success',data:{status:'FAILED',reason:'INSUFFICIENT_BALANCE'}},owned())).toBeUndefined();
  expect(chapaAuthorizationFeedback(reply('FAILED','<b>private payer details</b>'),owned())).toEqual({kind:'rejected',code:'AUTHORIZATION_FAILED'});
 });
 it.each(['PENDING','AUTH_NEEDED','SUCCESS'])('clears obsolete rejection only on a valid bound %s response',status=>{
  expect(chapaAuthorizationFeedback(reply(status,null),owned())).toEqual({kind:'waiting'});
 });
 it('reports a recognized authorization error while the provider still requests authorization',()=>{
  expect(chapaAuthorizationFeedback(reply('AUTH_NEEDED','INVALID_PIN'),owned())).toEqual({kind:'rejected',code:'INVALID_PIN'});
  expect(chapaAuthorizationFeedback(reply('AUTH_NEEDED','AUTHORIZATION_REQUIRED'),owned())).toEqual({kind:'waiting'});
 });
 it.each([['CANCELLED','PAYMENT_CANCELLED'],['INCOMPLETE','AUTHORIZATION_FAILED'],['EXPIRED','PAYMENT_EXPIRED'],['BLOCKED','PAYMENT_BLOCKED'],['FAILED_OR_CANCELLED','PAYMENT_FAILED_OR_CANCELLED']] as const)('keeps a bound %s response useful without fabricating a detailed reason', (status,code)=>{
  expect(chapaAuthorizationFeedback(reply(status,null),owned())).toEqual({kind:'rejected',code});
 });
 it.each([400,422])('retains a recognized structured HTTP%s request rejection',status=>{
  expect(chapaAuthorizationErrorFeedback(new ChapaProviderError(status,'INVALID_VALUE',undefined,'INSUFFICIENT_FUNDS'))).toEqual({kind:'rejected',code:'INSUFFICIENT_FUNDS'});
 });
 it.each([401,403,404,409,429,500,503])('does not turn HTTP%s transport/configuration/state problems into rejected authorization',status=>{
  expect(chapaAuthorizationErrorFeedback(new ChapaProviderError(status,'PROCESSING_FAILED',undefined,'INSUFFICIENT_FUNDS'))).toBeUndefined();
 });
 it('never parses an exception message or generic request error as a balance/PIN outcome',()=>{
  for(const value of [new TypeError('Insufficient balance'),new Error('INVALID_PIN'),new ChapaProviderError(400,'INVALID_VALUE')])expect(chapaAuthorizationErrorFeedback(value)).toBeUndefined();
 });
 it('publishes supplementary hints only while the private financial state is unresolved',()=>{
  const current={status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',reason:'CHAPA_AUTHORIZATION_INSUFFICIENT_FUNDS'};
  expect(publicChapaAuthorizationReason(current)).toBe('INSUFFICIENT_FUNDS');
  for(const patch of [{status:'CREDITED'},{providerStatus:'SUCCESS'},{status:'FAILED',providerStatus:'FAILED'},{verificationState:'MISMATCH'},{reason:'CHAPA_INSUFFICIENT_FUNDS'},{reason:'CHAPA_AUTHORIZATION_private 251911111111'}])expect(publicChapaAuthorizationReason({...current,...patch})).toBeNull();
  expect(chapaRequestReasonMessage('AUTHORIZATION_FAILED')).toContain('authorization was not completed');
  expect(chapaRequestReasonMessage('AUTHORIZATION_FAILED',true)).toContain('ፈቃዱ');
 });
});
