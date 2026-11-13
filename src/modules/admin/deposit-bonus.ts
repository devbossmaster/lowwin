import type {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {etbToCents} from '@/lib/money';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {depositBonusStorageReady,getDepositBonusPolicy} from '../wallet/deposit-bonus';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';
import {digest} from './crypto';

const money=z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
const inRange=(value:string,min:bigint)=>{try{const amount=etbToCents(value);return amount>=min&&amount<=4320000n}catch{return false}};
export const depositBonusPolicyInput=z.object({key:z.uuid(),version:z.number().int().nonnegative(),enabled:z.boolean(),percent:z.number().int().min(10).max(100),minAmount:money.refine(v=>inRange(v,100n)),maxBonus:money.refine(v=>inRange(v,1n)).nullable(),validityDays:z.number().int().min(1).max(365),endsAt:z.iso.datetime().nullable(),reason:z.string().trim().min(5).max(500)}).strict();
export async function readDepositBonusAdmin(client:PrismaClient,headers:Headers){
 await requireAdmin(client,headers,{permission:'settings'});const schemaReady=await depositBonusStorageReady(client,true);
 return {schemaReady,policy:await getDepositBonusPolicy(client,schemaReady)};
}
export async function saveDepositBonusAdmin(client:PrismaClient,headers:Headers,raw:unknown){
 const input=depositBonusPolicyInput.parse(raw),actor=await requireAdmin(client,headers,{permission:'settings'});
 if(!await depositBonusStorageReady(client,true))throw new AdminError(503,'Apply the deposit bonus migration before saving these settings.');
 if(!await allowIdentityRequest(client,'admin-deposit-bonus',actor.id,10))throw new AdminError(429,'Wait a minute before changing the bonus again.');
 const requestHash=digest(JSON.stringify(input));
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin:deposit-bonus-policy',0))`;
  const owner=await requireAdmin(tx,headers,{permission:'settings',lock:true}),operationKey=`deposit-bonus-policy:${owner.id}:${input.key}`;
  const previous=await tx.adminAudit.findUnique({where:{operationKey}});
  if(previous){if(previous.actorId!==owner.id||previous.action!=='DEPOSIT_BONUS_POLICY_UPDATED'||previous.requestHash!==requestHash)throw new AdminError(409,'Retry with the original bonus settings.');return (previous.details as unknown as {receipt:DepositBonusPolicyReceipt}).receipt;}
  const before=await tx.depositBonusPolicy.findUnique({where:{id:'default'}});
  if((before?.version??0)!==input.version)throw new AdminError(409,'Bonus settings changed. Refresh before saving.');
  const endsAt=input.endsAt?new Date(input.endsAt):null;if(input.enabled&&endsAt&&endsAt<=owner.now)throw new AdminError(422,'Choose a future offer end date or leave it empty.');
  const data={enabled:input.enabled,percent:input.percent,minCents:etbToCents(input.minAmount),maxBonusCents:input.maxBonus===null?null:etbToCents(input.maxBonus),validityDays:input.validityDays,endsAt,updatedBy:owner.id,updatedAt:owner.now};
  if(before)await tx.depositBonusPolicy.update({where:{id:'default'},data:{...data,version:{increment:1}}});else await tx.depositBonusPolicy.create({data:{id:'default',...data,version:1}});
  const receipt=await getDepositBonusPolicy(tx,true);
  await tx.adminAudit.create({data:{actorId:owner.id,action:'DEPOSIT_BONUS_POLICY_UPDATED',target:'default',operationKey,requestHash,details:{reason:input.reason,previous:before?{enabled:before.enabled,percent:before.percent,minAmount:before.minCents.toString(),maxBonus:before.maxBonusCents?.toString()??null,validityDays:before.validityDays,endsAt:before.endsAt?.toISOString()??null,version:before.version}:null,receipt}}});
  return receipt;
 },{maxWait:10000,timeout:30000});
}
export type DepositBonusPolicyReceipt=Awaited<ReturnType<typeof getDepositBonusPolicy>>;
export type DepositBonusAdminRead=Awaited<ReturnType<typeof readDepositBonusAdmin>>;
