import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {authenticateChapaWebhook,createdChapaDirect,parseChapaWebhook,verifyChapaWebhook} from '../src/modules/payments/chapa-provider';
import {chapaDeliveryProfileMatches} from '../src/modules/payments/chapa-webhook-profile';

// Complete payment examples supplied by the owner from the current v2 docs,
// with their documented optional fields retained. No merchant transport runs.
const shared={webhook_type:'payment',mode:'live',currency:'ETB',amount:'40000',service_fee:'1200',chapa_reference:'CHREF123',customer:{first_name:'Abebe',last_name:'Bikila',email:'abebebikila@chapa.co',phone_number:'+251960724272'},meta:{order_id:'ORD-99821'},created_at:'2025-11-07T13:00:00Z',updated_at:'2025-11-07T13:00:00Z'};
const examples=[
 {...shared,event:'payment.success',status:'success',payment_type:'Event',merchant_reference:'TXN123SUCCESS',payment_method:'telebirr'},
 {...shared,event:'payment.failed',status:'failed',payment_type:'API',merchant_reference:'TXN123FAILED',reason:'INSUFFICIENT_FUNDS'},
 {...shared,event:'payment.cancelled',status:'cancelled',payment_type:'Donation',merchant_reference:'TXN123CANCELLED',cancelled_by:'USER'},
 {...shared,event:'payment.incomplete',status:'incomplete',payment_type:'API',merchant_reference:'TXN123INCOMPLETE',reason:'TIMEOUT'},
 {...shared,event:'payment.auth_needed',status:'auth_needed',payment_type:'Direct charge',merchant_reference:'TXN123AUTH',auth_type:'PIN',created_at:'2025-11-07T12:00:00Z',expires_at:'2025-11-07T13:00:00Z'},
 {...shared,event:'payment.blocked',status:'blocked',payment_type:'API',merchant_reference:'TXN123BLOCKED',reason:'COMPLIANCE_REVIEW'},
];
const secret='fixture-current-webhook-signing-secret-20261117';
const sign=(body:string)=>createHmac('sha256',secret).update(body).digest('hex');

describe('complete current v2 payment webhook examples',()=>{
 it.each(examples)('accepts $event with exact raw-body authentication and correct routing',event=>{
  const raw=JSON.stringify(event,null,2),headers=new Headers({'x-chapa-signature':sign(raw)});
  expect(authenticateChapaWebhook(Buffer.from(raw),headers,{CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'raw_body'})).toBe('raw_body');
  expect(parseChapaWebhook(event)).toMatchObject({type:'payment',event:event.event,status:event.status,mode:'live',merchantReference:event.merchant_reference,chapaReference:'CHREF123',amountCents:'40000',serviceFeeCents:'1200',currency:'ETB',meta:{order_id:'ORD-99821'},updatedAt:new Date(shared.updated_at)});
 });
 it.each(examples.slice(1))('does not require an omitted payment_method in $event',event=>{
  const parsed=parseChapaWebhook(event);expect(parsed).not.toBeNull();expect(parsed!.paymentMethod).toBeUndefined();expect(parsed!.status).not.toBe('success');
 });
 it('distinguishes completion from the flow label and API response envelope',()=>{
  expect(parseChapaWebhook({...examples[4],payment_type:'Event'})?.status).toBe('auth_needed');
  expect(parseChapaWebhook({...examples[0],status:'SUCCESS'})).toBeNull();
  expect(parseChapaWebhook({status:'success',data:examples[0]})).toBeNull();
  expect(parseChapaWebhook({...examples[4],status:'success'})).toBeNull();
 });
 it('keeps cancellation attribution exact and provider reasons allowlisted',()=>{
  expect(parseChapaWebhook(examples[1])?.reasonCode).toBe('INSUFFICIENT_FUNDS');
  expect(parseChapaWebhook(examples[2])?.cancelledBy).toBe('USER');
  expect(parseChapaWebhook({...examples[2],cancelled_by:'SYSTEM'})?.cancelledBy).toBe('SYSTEM');
  expect(parseChapaWebhook({...examples[2],cancelled_by:'operator@example.com'})?.cancelledBy).toBeUndefined();
  for(const event of [examples[3],examples[5],{...examples[1],reason:'<script>private bank diagnostic</script>'}])expect(parseChapaWebhook(event)?.reasonCode).toBeUndefined();
 });
 it('treats the PIN authorization example as a hint, never a PIN form or completed payment',()=>{
  const parsed=parseChapaWebhook(examples[4]);expect(parsed?.status).toBe('auth_needed');expect(parsed).not.toHaveProperty('authType');expect(parsed).not.toHaveProperty('pin');
  expect(createdChapaDirect({status:'success',data:{auth_type:'PIN',chapa_reference:'CHREF123',payment_status:'AUTH_NEEDED',request_id:'fixture-request'}})).toBeNull();
 });
 it('authenticates the exact bytes and cannot substitute reserialized JSON or a legacy-secret proof',()=>{
  const raw=JSON.stringify(examples[0],null,2),signature=sign(raw);
  expect(verifyChapaWebhook(Buffer.from(raw),signature,secret)).toBe(true);
  expect(verifyChapaWebhook(Buffer.from(JSON.stringify(examples[0])),signature,secret)).toBe(false);
  expect(verifyChapaWebhook(Buffer.from(raw),signature.slice(1),secret)).toBe(false);
  expect(verifyChapaWebhook(Buffer.from(raw),null,secret)).toBe(false);
  const reusable=createHmac('sha256',secret).update(secret).digest('hex');
  expect(authenticateChapaWebhook(Buffer.from(raw),new Headers({'x-chapa-signature':reusable}),{CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'raw_body'})).toBeNull();
  expect(chapaDeliveryProfileMatches({webhookSignatureProfile:'raw_body'},'legacy_secret')).toBe(false);
 });
});
