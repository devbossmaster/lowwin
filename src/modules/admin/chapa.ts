import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {chapaAvailability,chapaHash} from '../payments/chapa-provider';
import {verifyChapaCheckout} from '../payments/chapa';
import {PAYMENT_TRANSACTION_OPTIONS} from '../payments/timing';

export const chapaAdminRoles:readonly StaffRole[]=['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'];
const writers:readonly StaffRole[]=['OWNER','PAYMENTS_OPERATOR'];
function allow(role:StaffRole,write=false){if(!(write?writers:chapaAdminRoles).includes(role))throw new AdminError(403,'Your staff role cannot perform this payment task.');}
const checkSchema=z.object({id:z.uuid(),key:z.uuid(),reason:z.string().trim().min(12).max(300)}).strict();
// Never select a checkout URL, ciphertext, raw evidence, initialization or receipt.
// The fingerprint is used only for server-side eligibility and is never returned.
const selection={id:true,userId:true,purpose:true,mode:true,credentialFingerprint:true,auctionId:true,auctionSlug:true,bidNumber:true,grossFee:true,discountPoints:true,feeVersion:true,amountCents:true,currency:true,status:true,reason:true,bidId:true,creditJournalId:true,merchantReference:true,chapaReference:true,processorReference:true,paymentMethod:true,attempts:true,nextCheckAt:true,expiresAt:true,createdAt:true,updatedAt:true,user:{select:{name:true}},auction:{select:{code:true,presentation:true,product:{select:{title:true}},terms:{select:{ruleVersion:true}}}}} satisfies Prisma.ChapaCheckoutSelect;
type Row=Prisma.ChapaCheckoutGetPayload<{select:typeof selection}>;
function safeReason(value:string|null){return value&&/^[A-Z0-9_]{1,64}$/.test(value)?value:null;}
function health(){const value=chapaAvailability();return {schemaReady:process.env.CHAPA_SCHEMA_READY==='true',configured:value.configured,recoveryEnabled:value.recoveryEnabled,mode:value.mode,reason:value.reason};}
function view(row:Row,role:StaffRole){
 const config=chapaAvailability(),sameConfiguration=config.mode===row.mode&&config.credentialFingerprint===row.credentialFingerprint;
 const presentation=row.auction?.presentation as {title?:string}|null|undefined;
 return {id:row.id,userId:row.userId,playerName:row.user.name,purpose:row.purpose,mode:row.mode,auctionId:row.auctionId,auctionSlug:row.auctionSlug,auctionCode:row.auction?.code??null,title:presentation?.title??row.auction?.product?.title??(row.purpose==='TOP_UP'?'Wallet top-up':'Auction'),ruleVersion:row.auction?.terms?.ruleVersion??null,bidNumber:row.bidNumber?.toString()??null,grossFee:row.grossFee?.toString()??null,discountPoints:row.discountPoints.toString(),feeVersion:row.feeVersion,amountCents:row.amountCents.toString(),currency:row.currency,status:row.status,reason:safeReason(row.reason),bidAccepted:row.bidId!==null,credited:row.creditJournalId!==null,paymentMethod:row.paymentMethod&&/^[a-zA-Z0-9_-]{1,64}$/.test(row.paymentMethod)?row.paymentMethod:null,attempts:row.attempts,nextCheckAt:row.nextCheckAt.toISOString(),expiresAt:row.expiresAt.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),canCheck:writers.includes(role)&&config.recoveryEnabled&&sameConfiguration&&!row.creditJournalId,configurationMatches:sameConfiguration,...(role==='SUPPORT'?{}:{references:{merchant:row.merchantReference,chapa:row.chapaReference,processor:row.processorReference,journalId:row.creditJournalId,bidId:row.bidId}})};
}
export async function readChapaAdmin(client:PrismaClient,headers:Headers,id:string){
 const actor=await requireAdmin(client,headers);allow(actor.role);
 if(process.env.CHAPA_SCHEMA_READY!=='true')throw new AdminError(503,'Chapa payment storage is not ready.');
 if(!await allowIdentityRequest(client,'admin-chapa-read',actor.id,60))throw new AdminError(429,'Wait a minute before loading more payments.');
 const row=await client.chapaCheckout.findUnique({where:{id:z.uuid().parse(id)},select:selection});
 if(!row)throw new AdminError(404,'Chapa payment not found.');
 await client.adminAudit.create({data:{actorId:actor.id,action:'CHAPA_DETAILS_READ',target:row.id,details:{}}});
 return {item:view(row,actor.role),health:health()};
}
export type ChapaAdminDetail=Awaited<ReturnType<typeof readChapaAdmin>>;

const receiptSchema=z.object({id:z.uuid(),status:z.string(),reason:z.string().nullable(),credited:z.boolean(),bidAccepted:z.boolean(),checkedAt:z.string().datetime()}).strict();
export type ChapaAdminCheckReceipt=z.infer<typeof receiptSchema>;
export async function checkChapaAdmin(client:PrismaClient,headers:Headers,input:unknown){
 const body=checkSchema.parse(input),actor=await requireAdmin(client,headers);allow(actor.role,true);
 if(process.env.CHAPA_SCHEMA_READY!=='true')throw new AdminError(503,'Chapa payment storage is not ready.');
 if(!chapaAvailability().recoveryEnabled)throw new AdminError(503,'Chapa verification is disabled. No payment was changed.');
 if(!await allowIdentityRequest(client,'admin-chapa-check',actor.id,10))throw new AdminError(429,'Wait a minute before checking more payments.');
 const operationKey=`chapa-check:${body.key}`,resultKey=`chapa-check-result:${body.key}`,requestHash=chapaHash(JSON.stringify(body));
 const reauthorize=async(tx:Prisma.TransactionClient)=>{const current=await requireAdmin(tx,headers,{lock:true});allow(current.role,true);if(current.id!==actor.id||current.sessionId!==actor.sessionId)throw new AdminError(403,'Sign in again before checking this payment.','ADMIN_LOGIN_REQUIRED');return current;};
 const previous=await client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operationKey},0))`;
  const current=await reauthorize(tx);
  const [attempt,completed]=await Promise.all([tx.adminAudit.findUnique({where:{operationKey}}),tx.adminAudit.findUnique({where:{operationKey:resultKey}})]);
  for(const prior of [attempt,completed])if(prior&&(prior.actorId!==actor.id||prior.requestHash!==requestHash))throw new AdminError(409,'Retry with the original payment details and request key.');
  if(completed)return receiptSchema.parse(completed.details);
  if(!await tx.chapaCheckout.findUnique({where:{id:body.id},select:{id:true}}))throw new AdminError(404,'Chapa payment not found.');
  if(!attempt)await tx.adminAudit.create({data:{actorId:current.id,action:'CHAPA_PROVIDER_CHECK',target:body.id,operationKey,requestHash,details:{reason:body.reason}}});
  return null;
 },PAYMENT_TRANSACTION_OPTIONS);
 if(previous)return previous;
 // Provider HTTP stays outside our audit transactions. The existing command
 // reauthorizes again inside the transaction that can credit money or accept a bid.
 await verifyChapaCheckout(client,body.id,undefined,async tx=>{await reauthorize(tx)});
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operationKey},0))`;
  const current=await reauthorize(tx),completed=await tx.adminAudit.findUnique({where:{operationKey:resultKey}});
  if(completed){if(completed.actorId!==actor.id||completed.requestHash!==requestHash)throw new AdminError(409,'Retry with the original payment details and request key.');return receiptSchema.parse(completed.details);}
  const row=await tx.chapaCheckout.findUniqueOrThrow({where:{id:body.id},select:{id:true,status:true,reason:true,creditJournalId:true,bidId:true}});
  const result={id:row.id,status:row.status,reason:safeReason(row.reason),credited:row.creditJournalId!==null,bidAccepted:row.bidId!==null,checkedAt:current.now.toISOString()};
  await tx.adminAudit.create({data:{actorId:current.id,action:'CHAPA_PROVIDER_CHECK_RESULT',target:body.id,operationKey:resultKey,requestHash,details:result}});
  return result;
 },PAYMENT_TRANSACTION_OPTIONS);
}
