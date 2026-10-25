import type {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';
import {digest} from './crypto';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {getReferralPolicy} from '../referrals/service';

export const referralPolicyInput=z.object({
 key:z.uuid(),version:z.number().int().min(0),enabled:z.boolean(),
 discountPercent:z.number().int().min(5).max(15),expiryDays:z.number().int().min(15).max(30),
 reason:z.string().trim().min(5).max(500),
}).strict();

export async function readReferralAdmin(client:PrismaClient,headers:Headers){
 await requireAdmin(client,headers,{permission:'settings'});
 return {schemaReady:process.env.REFERRAL_REWARDS_SCHEMA_READY==='true',policy:await getReferralPolicy(client)};
}

export async function saveReferralAdmin(client:PrismaClient,headers:Headers,raw:unknown){
 const input=referralPolicyInput.parse(raw);
 const actor=await requireAdmin(client,headers,{permission:'settings',fresh:true});
 if(process.env.REFERRAL_REWARDS_SCHEMA_READY!=='true')throw new AdminError(503,'Referral rewards storage is not configured. No settings were changed.');
 if(!await allowIdentityRequest(client,'admin-referral-policy',actor.id,10))throw new AdminError(429,'Wait a minute before changing referral settings again.');
 const requestHash=digest(JSON.stringify(input));
 return client.$transaction(async tx=>{
  // One policy lock serializes first creation and expected-version updates.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:referral-policy',0))`;
  const owner=await requireAdmin(tx,headers,{permission:'settings',fresh:true,lock:true});
  const operationKey=`referral-policy:${owner.id}:${input.key}`;
  const previousAttempt=await tx.adminAudit.findUnique({where:{operationKey}});
  if(previousAttempt){
   if(previousAttempt.actorId!==owner.id||previousAttempt.action!=='REFERRAL_POLICY_UPDATED'||previousAttempt.requestHash!==requestHash)throw new AdminError(409,'Retry with the original referral settings.');
   return (previousAttempt.details as unknown as {receipt:ReferralPolicyReceipt}).receipt;
  }
  const before=await tx.referralPolicy.findUnique({where:{id:'default'}});
  if((before?.version??0)!==input.version)throw new AdminError(409,'Referral settings changed. Reload before saving.');
  const fields={enabled:input.enabled,discountPercent:input.discountPercent,expiryDays:input.expiryDays,updatedBy:owner.id,updatedAt:owner.now};
  const saved=before?await tx.referralPolicy.update({where:{id:'default'},data:{...fields,version:{increment:1}}}):await tx.referralPolicy.create({data:{id:'default',...fields,version:1}});
  const receipt={configured:true,enabled:saved.enabled,discountPercent:saved.discountPercent,expiryDays:saved.expiryDays,version:saved.version,updatedAt:saved.updatedAt.toISOString()};
  await tx.adminAudit.create({data:{actorId:owner.id,action:'REFERRAL_POLICY_UPDATED',target:'default',operationKey,requestHash,details:{reason:input.reason,previous:before?{enabled:before.enabled,discountPercent:before.discountPercent,expiryDays:before.expiryDays,version:before.version}:null,receipt}}});
  return receipt;
 });
}
export type ReferralPolicyReceipt={configured:boolean;enabled:boolean;discountPercent:number;expiryDays:number;version:number;updatedAt:string|null};
export type ReferralAdminRead=Awaited<ReturnType<typeof readReferralAdmin>>;
