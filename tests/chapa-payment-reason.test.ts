import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {safeChapaPaymentReason,publicChapaPaymentReason,chapaPaymentReasonMessage} from '../src/lib/chapa-payment-reason';
import {parseChapaEvidence} from '../src/modules/payments/chapa-provider';
import {chapaPaymentPhase} from '../src/lib/chapa-status';
import {ChapaPaymentStatus,type useChapaPayment} from '../src/components/chapa-payment';
import {MiniLocaleProvider} from '../src/components/mini-locale';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

const response=(status:string,reason:unknown)=>({status:'success',data:{merchant_reference:'LW-reason-fixture',chapa_reference:'CH-reason-fixture',amount:1000,currency:'ETB',status,reason}});
const order=(change:Partial<ChapaCheckoutView>={})=>({id:'reason-fixture',purpose:'TOP_UP',mode:'test',amount:'10.00',status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',reason:'CHAPA_INSUFFICIENT_FUNDS',providerReasonCode:'INSUFFICIENT_FUNDS',createdAt:new Date(Date.now()-120000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),fundsPreserved:false,receipt:null,...change} as ChapaCheckoutView);
const phase=(value:ChapaCheckoutView,error='')=>chapaPaymentPhase({order:value,opening:false,restoring:false,paused:false,error});
const render=(value:ChapaCheckoutView)=>renderToStaticMarkup(createElement(MiniLocaleProvider,{initialLanguage:'en',children:createElement(ChapaPaymentStatus,{payment:{order:value,opening:false,restoring:false,paused:false,error:'',busy:false,attempt:null,handoff:'idle',canStartAgain:false} as ReturnType<typeof useChapaPayment>})}));

describe('safe reasons from matched merchant verification',()=>{
 it('shows a provider registration error only when Chapa verifies that outcome',()=>{
  const evidence=parseChapaEvidence(response('FAILED','PHONE_NOT_REGISTERED'));
  expect(evidence?.reasonCode).toBe('PAYMENT_ACCOUNT_NOT_FOUND');
  expect(chapaPaymentReasonMessage(order({providerReasonCode:'PAYMENT_ACCOUNT_NOT_FOUND'}))).toContain('number registered with that provider');
  expect(chapaPaymentReasonMessage(order({status:'PENDING',providerStatus:'PENDING',providerReasonCode:'PAYMENT_ACCOUNT_NOT_FOUND'}))).toBeNull();
  expect(safeChapaPaymentReason('PHONE_NOT_REGISTERED 251911111111')).toBeNull();
 });
 it.each(['INSUFFICIENT_FUNDS','insufficient balance.','INVALID_PIN','INCORRECT_PIN','WRONG_PIN','INVALID_OTP','AUTHORIZATION_REQUIRED'])('recognizes only an exact known reason: %s',value=>expect(safeChapaPaymentReason(value)).not.toBeNull());
 it.each([null,undefined,23,{},'<b>insufficient balance</b>','Insufficient balance for 251911111111','Internal SQL password error','WRONG_PIN customer=private','insufficient balance'.repeat(20)])('ignores unknown, structured, personal or markup reason: %j',value=>expect(safeChapaPaymentReason(value)).toBeNull());
 it.each(['FAILED','CANCELLED','INCOMPLETE','BLOCKED','AUTH_NEEDED'])('retains an optional safe reason with verified API status %s',status=>{
  expect(parseChapaEvidence(response(status,'INSUFFICIENT_BALANCE'))).toMatchObject({status,amountCents:'1000',merchantReference:'LW-reason-fixture',reasonCode:'INSUFFICIENT_FUNDS'});
 });
 it.each(['SUCCESS','PENDING'])('never lets a failure reason override API status %s',status=>{
  const evidence=parseChapaEvidence(response(status,'WRONG_PIN'));expect(evidence?.status).toBe(status);expect(evidence?.reasonCode).toBeUndefined();
 });
 it('ignores unsafe optional reasons without weakening exact financial evidence parsing',()=>{
  expect(parseChapaEvidence(response('FAILED','<script>private payer</script>'))?.reasonCode).toBeUndefined();
  const invalid=response('FAILED','INSUFFICIENT_FUNDS');expect(parseChapaEvidence({...invalid,data:{...invalid.data,amount:'1000'}})).toBeNull();
 });
 it('publishes only an allowlisted reason stored after server verification',()=>{
  const stored={reason:'CHAPA_INVALID_PIN',providerStatus:'FAILED',verificationState:'VERIFIED'};
  expect(publicChapaPaymentReason(stored)).toBe('INVALID_PIN');
  for(const patch of [{verificationState:'UNVERIFIED'},{verificationState:'UNAVAILABLE'},{verificationState:'MISMATCH'},{providerStatus:'PENDING'},{providerStatus:'SUCCESS'},{reason:'INVALID_PIN'},{reason:'CHAPA_private details'}])expect(publicChapaPaymentReason({...stored,...patch})).toBeNull();
 });
 it('displays a known verified reason, with generic text for an unverified or unsafe one',()=>{
  expect(render(order())).toContain('Chapa reports insufficient funds');
  for(const patch of [{verificationState:'UNVERIFIED'},{providerReasonCode:'<script>private payer</script>'},{providerReasonCode:null}])expect(render(order(patch))).not.toContain('reports insufficient funds');
  expect(chapaPaymentReasonMessage(order({providerReasonCode:'INVALID_PIN'}),true)).toContain('PIN');
 });
 it('keeps an authorization problem actionable rather than hiding it behind the 90-second wait',()=>{
  const value=order({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',providerReasonCode:'INVALID_PIN'});
  expect(phase(value)).toBe('authorization');const html=render(value);expect(html).toContain('incorrect payment PIN');expect(html).not.toContain('data-payment-long-wait="true"');
 });
 it('does not infer failure from closure, timeout or a provisional reason; late success wins',()=>{
  const value=order({status:'PENDING',providerStatus:'PENDING',verificationState:'UNVERIFIED',createdAt:new Date(Date.now()-600000).toISOString()});
  expect(chapaPaymentReasonMessage(value)).toBeNull();expect(phase(value)).toBe('session-ended');expect(phase(value,'Timed out')).toBe('session-ended');
  const success={...value,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'};
  expect(phase(success,'Stale timeout')).toBe('confirmed');expect(chapaPaymentReasonMessage(success)).toBeNull();
 });
});
