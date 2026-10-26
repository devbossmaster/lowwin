import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from '../admin/boundary';
import {AdminError} from '../admin/errors';
import {materializeAlert} from '../notifications/service';
import {assertDepositEligibility,paymentHealth} from './service';
import {creditTransfer} from './credit';
import {candidate,depositBankSchema,hash,PaymentError} from './provider';
import {protectedPayment} from './retry';

export const manualApprovalSchema=z.object({
 key:z.string().uuid(),id:z.string().uuid(),amountCents:z.string().regex(/^[1-9]\d{0,10}$/),
 reference:z.string().trim().min(8).max(128),otherReference:z.string().trim().max(128).optional().default(''),
 transferredAt:z.iso.datetime({offset:true}),reason:z.string().trim().max(500).optional().default(''),confirmed:z.literal(true),
}).strict();
type ReviewDeposit=Pick<TopUpIntent,'status'|'caseState'|'provider'|'channel'|'receivingAccount'|'journalId'|'leaseUntil'>;
export function depositApprovalBlocker(t:ReviewDeposit,now:Date,active:boolean,claimed=false):string|null{
 if(claimed||t.journalId||t.status==='CREDITED')return 'This deposit has already been credited. It cannot be credited again.';
 if(t.status==='REJECTED')return 'This deposit was rejected. Manual approval is unavailable for rejected deposits.';
 if(protectedPayment(t))return 'This deposit is protected or archived. Manual approval is unavailable in its current review state.';
 if(active||t.leaseUntil&&t.leaseUntil>now||t.status==='VERIFYING')return 'Automatic verification is still in progress. Refresh after it finishes to check manual approval.';
 if(!['NEEDS_REVIEW','PROVIDER_OUTAGE','PENDING'].includes(t.status))return 'Manual approval is unavailable for this deposit status.';
 if(!['CHECK_ET','VERIFY_ET'].includes(t.provider)||!depositBankSchema.safeParse(t.channel).success)return 'This deposit type does not support manual approval.';
 if(!t.receivingAccount)return 'This deposit has no receiving account recorded. Its receipt cannot be manually approved.';
 return null;
}
export function canReviewDeposit(t:ReviewDeposit,now:Date,active:boolean,claimed=false){
 return depositApprovalBlocker(t,now,active,claimed)===null;
}
export async function approveReviewedDeposit(client:PrismaClient,headers:Headers,raw:unknown){
 const b=manualApprovalSchema.parse(raw);
 return client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${b.id} FOR UPDATE`;
  const actor=await requireAdmin(tx,headers,{lock:true});
  if(!['OWNER','PAYMENTS_OPERATOR'].includes(actor.role))throw new AdminError(403,'Payment approval is not granted to this role.');
  const t=await tx.topUpIntent.findUnique({where:{id:b.id}});if(!t)throw new PaymentError(404,'Deposit not found.');
  const fingerprint=hash(JSON.stringify({action:'approve',...b}));
  const prior=await tx.adminAudit.findUnique({where:{operationKey:b.key}});
  if(prior){if(prior.requestHash!==fingerprint||prior.target!==t.id)throw new PaymentError(409,'Idempotency key changed.');return {recorded:true,status:t.status,amountCents:t.expectedCents?.toString()}}
  const [claimed,active]=await Promise.all([tx.paymentClaim.findUnique({where:{intentId:t.id}}),tx.verifyRequest.findFirst({where:{intentId:t.id,state:{in:['SUBMITTING','PROCESSING']}},select:{id:true}})]);
  const blocked=depositApprovalBlocker(t,actor.now,!!active,!!claimed);
  if(blocked)throw new PaymentError(409,blocked);
  if(!paymentHealth().enabled)throw new PaymentError(503,'Payment crediting is paused.');
  await assertDepositEligibility(tx,t.userId);
  const bank=depositBankSchema.parse(t.channel),reference=candidate(bank,b.reference);
  if(b.otherReference&&bank!=='cbe')throw new PaymentError(422,'Additional receipt references are supported only for CBE.');
  if(t.reference&&t.reference!==reference)throw new PaymentError(409,'The transaction ID must match the submitted deposit.');
  const aliases=[reference,...(b.otherReference?[candidate(bank,b.otherReference)]:[])];
  const amount=BigInt(b.amountCents),points=new Prisma.Decimal(b.amountCents).div(100),transferredAt=new Date(b.transferredAt);
  const quote=t.quoteSnapshot as {minCents?:string;maxCents?:string;earliestTransferAt?:string}|null;
  if(t.amountFromReceipt){
   if(!quote?.minCents||!quote.maxCents||!quote.earliestTransferAt||amount<BigInt(quote.minCents)||amount>BigInt(quote.maxCents))throw new PaymentError(422,'The verified amount must be within this deposit’s published range.');
  }else if(t.expectedCents!==amount||!t.points.eq(points))throw new PaymentError(422,'The amount must match this deposit’s original quote.');
  const earliest=quote?.earliestTransferAt?new Date(quote.earliestTransferAt):new Date(t.createdAt.getTime()-86400000);
  if(points.gt(1000000000)||!Number.isFinite(earliest.getTime())||transferredAt<earliest||transferredAt>actor.now||!t.expiresAt||transferredAt>t.expiresAt)throw new PaymentError(422,'Check the verified amount and transfer date against this deposit’s receipt window.');
  const evidenceHash=hash(JSON.stringify({source:'MANUAL_REVIEW',actorId:actor.id,sessionId:actor.sessionId,...b,reference,aliases}));
  const journalId=await creditTransfer(tx,t,{reference,aliases,amountCents:amount,points,receiverSuffix:t.receivingAccount!.slice(-4),transferredAt,evidenceHash});
  if(!journalId)throw new PaymentError(409,'This transaction ID has already been credited. No additional credit was added.');
  await tx.topUpIntent.update({where:{id:t.id},data:{status:'CREDITED',journalId,reference,...(t.amountFromReceipt?{expectedCents:amount,points}:{}),reasonCode:'MANUALLY_APPROVED',caseState:'RESOLVED',assignedTo:actor.id,leaseToken:null,leaseUntil:null}});
  await tx.paymentAttempt.create({data:{intentId:t.id,key:b.key,requestHash:fingerprint,code:'MANUALLY_APPROVED',evidence:{source:'MANUAL_REVIEW',currency:'ETB',amountCents:b.amountCents,receiverSuffix:t.receivingAccount!.slice(-4),date:transferredAt.toISOString(),hash:evidenceHash,aliasCount:new Set(aliases).size}}});
  await tx.adminAudit.create({data:{actorId:actor.id,action:'PAYMENT_APPROVE',target:t.id,operationKey:b.key,requestHash:fingerprint,details:{source:'MANUAL_REVIEW',sessionId:actor.sessionId,reason:b.reason||'Staff confirmed the receipt and receiving-account checks.',amountCents:b.amountCents,transferredAt:b.transferredAt,referenceHash:hash(reference),journalId}}});
  const row=await tx.outbox.create({data:{key:`deposit:${t.id}:credited`,kind:'DEPOSIT_CREDITED',payload:{intentId:t.id,recipientUserId:t.userId}}});await materializeAlert(tx,row);
  return {recorded:true,status:'CREDITED',amountCents:b.amountCents};
 },{timeout:15000});
}
