import {Prisma,type PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {requireAdmin} from '../admin/boundary';
import {AdminError} from '../admin/errors';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {materializeAlert} from '../notifications/service';
import {assertDepositEligibility,paymentHealth} from './service';
import {candidate,depositBankSchema,hash,PaymentError} from './provider';
import {depositApprovalBlocker} from './manual-approval';

export const adminCreditSchema=z.object({
 key:z.string().uuid(),id:z.string().uuid(),amountCents:z.string().regex(/^[1-9]\d{0,6}$/).refine(v=>Number(v)<=1000000,'Maximum credit is ETB 10,000.'),
 reason:z.string().trim().min(3).max(500),reference:z.string().trim().max(128).optional().default(''),
}).strict();

/** Resolve one uncredited deposit with a separate, honestly labelled admin credit.
 * No transfer timestamp or receipt evidence is invented. All effects commit together. */
export async function addAdminFunds(client:PrismaClient,headers:Headers,raw:unknown){
 const b=adminCreditSchema.parse(raw);
 return client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${b.id} FOR UPDATE`;
  const actor=await requireAdmin(tx,headers,{lock:true});
  if(actor.role!=='OWNER')throw new AdminError(403,'Only an Owner can add funds without verified receipt evidence.');
  const t=await tx.topUpIntent.findUnique({where:{id:b.id}});if(!t)throw new PaymentError(404,'Deposit not found.');
  const fingerprint=hash(JSON.stringify({action:'add-funds',actorId:actor.id,...b}));
  const prior=await tx.adminAudit.findUnique({where:{operationKey:b.key}});
  if(prior){
   if(prior.requestHash!==fingerprint||prior.target!==t.id)throw new PaymentError(409,'Idempotency key changed.');
   const credit=await tx.adminWalletCredit.findUniqueOrThrow({where:{sourceIntentId:t.id}});
   return {recorded:true,status:'CREDITED',intentId:credit.intentId,amountCents:credit.amountCents.toString()};
  }
  const [claimed,active,replacement]=await Promise.all([
   tx.paymentClaim.findUnique({where:{intentId:t.id}}),
   tx.verifyRequest.findFirst({where:{intentId:t.id,state:{in:['SUBMITTING','PROCESSING']}},select:{id:true}}),
   tx.adminWalletCredit.findUnique({where:{sourceIntentId:t.id}}),
  ]);
  if(replacement)throw new PaymentError(409,'Funds have already been added for this deposit.');
  const blocked=depositApprovalBlocker(t,actor.now,!!active,!!claimed);if(blocked)throw new PaymentError(409,blocked);
  if(!paymentHealth().enabled)throw new PaymentError(503,'Payment crediting is paused.');
  await assertDepositEligibility(tx,t.userId);
  const bank=depositBankSchema.parse(t.channel);
  // A reference already supplied by the customer cannot be discarded to evade deduplication.
  const reference=b.reference?candidate(bank,b.reference):t.reference;
  if(t.reference&&reference!==t.reference)throw new PaymentError(409,'The transaction ID must match the submitted deposit.');
  if(reference){
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${bank}:${reference}`},0))`;
   const [claim,alias,credit]=await Promise.all([
    tx.paymentClaim.findUnique({where:{channel_reference:{channel:bank,reference}}}),
    tx.paymentTransferAlias.findUnique({where:{channel_alias:{channel:bank,alias:reference}}}),
    tx.adminWalletCredit.findUnique({where:{channel_reference:{channel:bank,reference}}}),
   ]);
   if(claim||alias||credit)throw new PaymentError(409,'This transaction ID has already been credited.');
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${t.userId}`},0))`;
  await ensureWallet(tx,t.userId);await seedPlatformAccounts(tx);
  const [available,issuance]=await Promise.all([
   tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${t.userId}:available`}}),
   tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),
  ]);
  const id=randomUUID(),points=new Prisma.Decimal(b.amountCents).div(100);
  const operation=await tx.operation.create({data:{userId:t.userId,scope:'ADMIN_CREDIT',key:t.id,requestHash:fingerprint,result:{intentId:id,amountCents:b.amountCents}}});
  const journal=await tx.journal.create({data:{operationId:operation.id,kind:'ADMIN_CREDIT',reference:`admin-credit:${id}`,postings:{create:[{accountId:issuance.id,delta:points.negated()},{accountId:available.id,delta:points}]}}});
  await tx.topUpIntent.create({data:{id,userId:t.userId,key:b.key,provider:'ADMIN_CREDIT',channel:'manual',status:'CREDITED',points,expectedCents:BigInt(b.amountCents),policyVersion:'admin-credit-v1',journalId:journal.id,reference,requestHash:fingerprint,caseState:'RESOLVED',assignedTo:actor.id,reasonCode:'ADMIN_CREDIT'}});
  await tx.adminWalletCredit.create({data:{intentId:id,sourceIntentId:t.id,userId:t.userId,actorId:actor.id,amountCents:BigInt(b.amountCents),reason:b.reason,channel:reference?bank:null,reference,operationId:operation.id,journalId:journal.id}});
  await tx.topUpIntent.update({where:{id:t.id},data:{status:'REJECTED',caseState:'RESOLVED',reasonCode:'ADMIN_CREDIT_REPLACEMENT',assignedTo:actor.id,leaseToken:null,leaseUntil:null}});
  await tx.adminAudit.create({data:{actorId:actor.id,action:'PAYMENT_ADD_FUNDS',target:t.id,operationKey:b.key,requestHash:fingerprint,details:{sessionId:actor.sessionId,reason:b.reason,amountCents:b.amountCents,creditIntentId:id,journalId:journal.id,referenceProvided:!!reference}}});
  const row=await tx.outbox.create({data:{key:`deposit:${id}:credited`,kind:'DEPOSIT_CREDITED',payload:{intentId:id,recipientUserId:t.userId}}});
  await materializeAlert(tx,row);
  return {recorded:true,status:'CREDITED',intentId:id,amountCents:b.amountCents};
 },{timeout:20000});
}
