import {type PaymentPolicy,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from '../admin/boundary';
import {AdminError} from '../admin/errors';
import {depositBankSchema,hash,PaymentError} from './provider';

const removalSchema=z.object({key:z.string().uuid(),id:z.string().uuid(),channel:depositBankSchema,version:z.number().int().positive()}).strict();
const removalAction='PAYMENT_POLICY_REMOVE';

export async function receivingAccountStates(client:PrismaClient,policies:(PaymentPolicy|null)[]){
 const ids=policies.filter((p):p is PaymentPolicy=>!!p).map(p=>p.id);
 const audits=ids.length?await client.adminAudit.findMany({where:{action:removalAction,target:{in:ids}},select:{target:true}}):[];
 const removed=new Set(audits.map(a=>a.target));
 return policies.map(p=>p?{...p,removed:removed.has(p.id)}:null);
}

// Policies are immutable. A disabled successor plus an immutable audit marks the
// account removed from current setup, preserving every historical deposit quote.
export async function removeReceivingAccount(client:PrismaClient,headers:Headers,raw:unknown){
 const b=removalSchema.parse(raw),fingerprint=hash(JSON.stringify({action:removalAction,...b}));
 return client.$transaction(async tx=>{
  const actor=await requireAdmin(tx,headers,{lock:true});
  if(actor.role!=='OWNER')throw new AdminError(403,'Owner permission required.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-policy:${b.channel}`},0))`;
  const prior=await tx.adminAudit.findUnique({where:{operationKey:b.key}});
  if(prior){
   if(prior.action!==removalAction||prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');
   return {removed:true,version:(prior.details as {version:number}).version};
  }
  const latest=await tx.paymentPolicy.findFirst({where:{channel:b.channel},orderBy:{version:'desc'}});
  if(!latest||latest.id!==b.id||latest.version!==b.version)throw new PaymentError(409,'Account changed. Refresh and review it again.');
  if(await tx.adminAudit.findFirst({where:{action:removalAction,target:latest.id},select:{id:true}}))throw new PaymentError(409,'This receiving account has already been removed.');
  const policy=await tx.paymentPolicy.create({data:{channel:latest.channel,version:latest.version+1,enabled:false,account:latest.account,accountName:latest.accountName,pointsNumerator:latest.pointsNumerator,centsDenominator:latest.centsDenominator,minCents:latest.minCents,maxCents:latest.maxCents,terms:latest.terms,reviewReference:latest.reviewReference,actorId:actor.id}});
  await tx.adminAudit.create({data:{actorId:actor.id,action:removalAction,target:policy.id,operationKey:b.key,requestHash:fingerprint,details:{sessionId:actor.sessionId,reason:'Receiving account removed by Owner. Historical deposit quotes retained.',previousPolicyId:latest.id,channel:policy.channel,version:policy.version}}});
  return {removed:true,version:policy.version};
 });
}
