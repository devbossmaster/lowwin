import {describe,expect,it,vi} from 'vitest';
import type {ChapaCheckout,PrismaClient} from '@prisma/client';
import {resolvedChapaWebhookReason} from '../src/modules/payments/chapa-webhook-reason';
import {parseChapaEvidence,parseChapaWebhook} from '../src/modules/payments/chapa-provider';
import {chapaPaymentReasonMessage,publicChapaCancelledBy} from '../src/lib/chapa-payment-reason';

const updated=new Date('2026-11-17T10:00:00Z');
const order={id:'owned-original',merchantReference:'LWowned',chapaReference:'CHowned',mode:'test',paymentMethod:'telebirr'} as ChapaCheckout;
const proof=(status='FAILED')=>parseChapaEvidence({status:'success',data:{status,merchant_reference:'LWowned',chapa_reference:'CHowned',amount:1000,currency:'ETB',payment_method:'telebirr',updated_at:updated.toISOString()}})!;
const fixture=(row:unknown)=>{const findFirst=vi.fn(async(_query:unknown)=>row);return {findFirst,client:{chapaWebhookEvent:{findFirst}} as unknown as PrismaClient}};

describe('allowlisted signed webhook feedback',()=>{
 it('retains recognized reasons and exact cancellation attribution while discarding raw text',()=>{
  const base={webhook_type:'payment',event:'payment.failed',status:'failed',reason:'INSUFFICIENT_BALANCE',message:'private bank payload 251911111111'};
  expect(parseChapaWebhook(base)).toMatchObject({reasonCode:'INSUFFICIENT_FUNDS'});
  expect(JSON.stringify(parseChapaWebhook({...base,reason:'private bank payload 251911111111'}))).not.toContain('private bank');
  for(const cancelled_by of ['USER','SYSTEM'])expect(parseChapaWebhook({...base,event:'payment.cancelled',status:'cancelled',cancelled_by})).toMatchObject({cancelledBy:cancelled_by});
  for(const cancelled_by of ['user','CUSTOMER','USER private',null,42])expect(parseChapaWebhook({...base,event:'payment.cancelled',status:'cancelled',cancelled_by})?.cancelledBy).toBeUndefined();
  expect(parseChapaWebhook({...base,cancelled_by:'USER'})?.cancelledBy).toBeUndefined();
 });
 it('resolves only feedback for the owned, privately verified status/reference/environment',async()=>{
  const f=fixture({providerReasonCode:'INSUFFICIENT_FUNDS',cancelledBy:null,providerUpdatedAt:updated,paymentMethod:'telebirr'});
  expect(await resolvedChapaWebhookReason(f.client,order,proof())).toEqual({reasonCode:'INSUFFICIENT_FUNDS',cancelledBy:undefined});
  expect(f.findFirst.mock.calls[0][0]).toMatchObject({where:{checkoutId:order.id,merchantReference:'LWowned',chapaReference:'CHowned',mode:'test',event:'payment.failed',status:{not:'IGNORED'}}});
 });
 it('retains previously authenticated owned feedback across signing-secret rotation',async()=>{
  const f=fixture({configurationFingerprint:'previous-signing-secret-hash',providerReasonCode:'PAYMENT_CANCELLED',cancelledBy:'USER',providerUpdatedAt:updated,paymentMethod:'telebirr'});
  expect(await resolvedChapaWebhookReason(f.client,order,proof('CANCELLED'))).toEqual({reasonCode:'PAYMENT_CANCELLED',cancelledBy:'USER'});
  const where=(f.findFirst.mock.calls[0][0] as {where:Record<string,unknown>}).where;
  expect(where).not.toHaveProperty('configurationFingerprint');expect(where).toMatchObject({checkoutId:order.id,merchantReference:order.merchantReference,chapaReference:order.chapaReference,mode:order.mode,event:'payment.cancelled'});
 });
 it('ignores conflicting methods, stale resource revisions and arbitrary stored reasons',async()=>{
  for(const patch of [{paymentMethod:'mpesa'},{providerUpdatedAt:new Date(updated.getTime()-1000)}]){
   const f=fixture({providerReasonCode:'INVALID_PIN',cancelledBy:'USER',providerUpdatedAt:updated,paymentMethod:'telebirr',...patch});
   expect(await resolvedChapaWebhookReason(f.client,order,proof())).toEqual({});
  }
  const f=fixture({providerReasonCode:'private internal text',cancelledBy:'USER',providerUpdatedAt:updated,paymentMethod:'telebirr'});
  expect(await resolvedChapaWebhookReason(f.client,order,proof())).toEqual({reasonCode:undefined,cancelledBy:undefined});
 });
 it('does not carry old USER attribution past the latest delivery with no attribution',async()=>{
  const f=fixture({providerReasonCode:null,cancelledBy:null,providerUpdatedAt:updated,paymentMethod:'telebirr'});
  expect(await resolvedChapaWebhookReason(f.client,order,proof('CANCELLED'))).toEqual({reasonCode:undefined,cancelledBy:undefined});
  expect(f.findFirst.mock.calls[0][0]).toMatchObject({orderBy:[{receivedAt:'desc'},{id:'desc'}]});
 });
 it('never adds a failure reason to pending or successful private evidence',async()=>{
  const f=fixture({providerReasonCode:'INVALID_PIN',cancelledBy:'USER'});
  for(const status of ['SUCCESS','PENDING'])expect(await resolvedChapaWebhookReason(f.client,order,proof(status))).toEqual({});
  expect(f.findFirst).not.toHaveBeenCalled();
 });
 it('says You cancelled only for a privately verified cancellation with supported USER attribution',()=>{
  const cancelled={status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerCancelledBy:'USER',providerReasonCode:'PAYMENT_CANCELLED'};
  expect(publicChapaCancelledBy(cancelled)).toBe('USER');
  expect(chapaPaymentReasonMessage(cancelled)).toBe('You cancelled this payment.');
  expect(chapaPaymentReasonMessage(cancelled,true)).toContain('እርስዎ');
  for(const patch of [{providerCancelledBy:'SYSTEM'},{providerCancelledBy:'user'},{providerCancelledBy:null},{verificationState:'UNVERIFIED'},{providerStatus:'FAILED',status:'FAILED'}]){
   expect(chapaPaymentReasonMessage({...cancelled,...patch})??'').not.toContain('You cancelled');
  }
 });
 it('recognizes the documented simulator cancellation code without inventing USER attribution',()=>{
  const hint=parseChapaWebhook({webhook_type:'payment',event:'payment.cancelled',status:'cancelled',reason:'USER_CANCELLED'});
  expect(hint?.reasonCode).toBe('PAYMENT_CANCELLED');expect(hint?.cancelledBy).toBeUndefined();
  const cancelled={status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:hint?.reasonCode};
  expect(chapaPaymentReasonMessage(cancelled)).toContain('was cancelled');expect(chapaPaymentReasonMessage(cancelled)).not.toContain('You cancelled');
 });
});
