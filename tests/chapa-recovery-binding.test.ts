import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {chapaAvailability} from '../src/modules/payments/chapa-provider';
import {approvedRecoveryBinding,chapaRecoveryBindings,matchingRecoveryBinding,recoveryAuthorizationAction,recoveryAuthorizationKey,recoveryBindingHash,type ChapaRecoveryBinding} from '../src/modules/payments/chapa-recovery-binding';

function fixture(){
 const env={APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'b'.repeat(40),CHAPA_WEBHOOK_SECRET:'isolated-binding-webhook-secret-thirty-two-characters',CHAPA_SCHEMA_READY:'true',CHAPA_MERCHANT_REVIEWED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_ENABLED:'false',MINI_APP_URL:'https://lowwin.test/telegram',BETTER_AUTH_URL:'https://lowwin.test',CHAPA_RECOVERY_BINDINGS:''};
 const order={id:randomUUID(),mode:'live',credentialFingerprint:'a'.repeat(64),requestHash:'c'.repeat(64),merchantReference:'LWrecoveryfixture',amountCents:1000n,currency:'ETB'};
 const binding:ChapaRecoveryBinding={checkoutId:order.id,mode:'live',fromFingerprint:order.credentialFingerprint,toFingerprint:chapaAvailability(env).credentialFingerprint!,requestHash:order.requestHash,merchantReference:order.merchantReference,amountCents:'1000',currency:'ETB',finalReference:'CHverifiedfixture',expiresAt:new Date(Date.now()+3600000).toISOString()};
 env.CHAPA_RECOVERY_BINDINGS=JSON.stringify([binding]);return {env,order,binding};
}
describe('explicit, bounded Chapa credential-recovery authorization',()=>{
 it('scopes a replacement key to one immutable checkout and original money',()=>{
  const {env,order,binding}=fixture();expect(matchingRecoveryBinding(order,env)).toEqual(binding);
  for(const change of [{id:randomUUID()},{mode:'test'},{credentialFingerprint:'d'.repeat(64)},{requestHash:'e'.repeat(64)},{merchantReference:'another'},{amountCents:999n},{currency:'USD'}])expect(matchingRecoveryBinding({...order,...change},env)).toBeNull();
  expect(matchingRecoveryBinding(order,{...env,CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'d'.repeat(40)})).toBeNull();
 });
 it('fails closed for malformed, broad, expired or excessive authorizations',()=>{
  const {env,binding}=fixture();for(const value of ['', 'not-json', '{}', JSON.stringify([{...binding,extra:'ignored?'}]),JSON.stringify([{...binding,fromFingerprint:binding.toFingerprint}]),JSON.stringify([{...binding,mode:'test'}]),JSON.stringify([{...binding,expiresAt:new Date(Date.now()-1000).toISOString()}]),JSON.stringify([{...binding,expiresAt:new Date(Date.now()+2*86400000).toISOString()}]),JSON.stringify(Array(21).fill(binding)),'x'.repeat(20001)])expect(chapaRecoveryBindings({...env,CHAPA_RECOVERY_BINDINGS:value})).toEqual([]);
 });
 it('requires an immutable matching audit, not just an environment entry',async()=>{
  const {env,order,binding}=fixture();const audit={action:recoveryAuthorizationAction,target:order.id,requestHash:recoveryBindingHash(binding),details:{binding},createdAt:new Date()};
  const findUnique=vi.fn(async()=>audit as typeof audit|null),client={adminAudit:{findUnique}} as unknown as PrismaClient;
  expect(await approvedRecoveryBinding(client,order,env)).toEqual(binding);expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{operationKey:recoveryAuthorizationKey(binding)}}));
  for(const returned of [null,{...audit,action:'ANOTHER_ACTION'},{...audit,target:randomUUID()},{...audit,requestHash:'f'.repeat(64)},{...audit,details:{binding:{...binding,amountCents:'2000'}}},{...audit,createdAt:new Date(Date.now()-2*86400000)}]){
   findUnique.mockResolvedValueOnce(returned as typeof audit|null);expect(await approvedRecoveryBinding(client,order,env)).toBeNull();
  }
 });
});
