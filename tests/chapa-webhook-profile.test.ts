import {createHmac} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {authenticateChapaDelivery,chapaDeliveryProfileMatches} from '../src/modules/payments/chapa-webhook-profile';

const secret='isolated-signature-profile-secret-'+'s'.repeat(32),bytes=Buffer.from('{ "event":"payment.success", "amount":1000 }\n');
const sign=(value:string|Uint8Array)=>createHmac('sha256',secret).update(value).digest('hex');
describe('immutable payment webhook authentication profile',()=>{
 it('refuses a reusable proof for a raw-body-pinned payment while preserving historical hints',()=>{
  const authentication=authenticateChapaDelivery(bytes,new Headers({'x-chapa-signature':sign(secret)}),{CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'legacy_secret'});
  expect(authentication).toBe('legacy_secret');
  expect(chapaDeliveryProfileMatches({webhookSignatureProfile:'raw_body'},authentication!)).toBe(false);
  for(const initialization of [{},{apiVersion:'v2',flowVersion:4},{webhookSignatureProfile:'legacy_secret'}])expect(chapaDeliveryProfileMatches(initialization,authentication!)).toBe(true);
 });
 it('accepts exact raw-body proof as a stronger upgrade for explicit legacy recovery',()=>{
  const authentication=authenticateChapaDelivery(bytes,new Headers({'x-chapa-signature':sign(bytes),'chapa-signature':'invalid'}),{CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'legacy_secret'});
  expect(authentication).toBe('raw_body');expect(chapaDeliveryProfileMatches({webhookSignatureProfile:'raw_body'},authentication!)).toBe(true);expect(chapaDeliveryProfileMatches({webhookSignatureProfile:'legacy_secret'},authentication!)).toBe(true);
 });
 it('does not authenticate altered bytes, an unconfigured profile or a legacy proof under raw-body configuration',()=>{
  const headers=new Headers({'x-chapa-signature':sign(bytes)});
  expect(authenticateChapaDelivery(Buffer.concat([bytes,Buffer.from(' ')]),headers,{CHAPA_WEBHOOK_SECRET:secret})).toBeNull();
  expect(authenticateChapaDelivery(bytes,headers,{CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'unknown'})).toBeNull();
  expect(authenticateChapaDelivery(bytes,new Headers({'x-chapa-signature':sign(secret)}),{CHAPA_WEBHOOK_SECRET:secret})).toBeNull();
  for(const profile of [null,'','unknown',42])expect(chapaDeliveryProfileMatches({webhookSignatureProfile:profile},'legacy_secret')).toBe(false);
 });
});
