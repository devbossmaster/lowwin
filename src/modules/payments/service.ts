import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';
import {z} from 'zod';
import {demoBidAllowed} from '../auctions/bids';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {bankSchema,candidate,checkEt,hash,PaymentError,type VerifyTransport,type Bank} from './provider';
type Tx=Prisma.TransactionClient;
export function paymentHealth(){
 // Release interlock: this implementation cannot activate production crediting.
 const isolated=demoBidAllowed(),configured=isolated&&process.env.CHECK_ET_MODE==='test'&&!!process.env.CHECK_ET_TEST_API_KEY&&process.env.PAYMENTS_TEST_ENABLED==='true';
 return {enabled:configured,productionEnabled:false,ocr:configured&&process.env.RECEIPT_OCR==='tesseract',reason:configured?'Isolated test verification only. Do not send real funds.':'Adding points is unavailable until receiving accounts, conversion terms and verification are reviewed.'};
}
function requireEnabled(){if(!paymentHealth().enabled)throw new PaymentError(503,paymentHealth().reason)}
async function clock(tx:Tx){return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now}
async function eligibility(tx:Tx,userId:string){if(await tx.staffMember.findUnique({where:{userId}})||await tx.userRestriction.findFirst({where:{userId,suspended:true}}))throw new PaymentError(403,'Adding points is unavailable for this account.')}
const int=z.string().regex(/^[1-9]\d{0,10}$/);
const createSchema=z.object({key:z.string().uuid(),channel:bankSchema,policyId:z.string().uuid(),amountCents:int}).strict();
export function ownIntent(t:TopUpIntent){return {id:t.id,channel:t.channel,status:t.status,amountCents:t.expectedCents?.toString(),points:t.points.toString(),policyVersion:t.policyVersion,quote:t.quoteSnapshot,account:t.receivingAccount,accountName:t.accountName,createdAt:t.createdAt.toISOString(),expiresAt:t.expiresAt?.toISOString(),reference:t.reference,reason:t.reasonCode,attempts:t.attempts,nextAttemptAt:t.nextAttemptAt.toISOString(),caseState:t.caseState};}
export async function fundingOptions(client:PrismaClient){const policies=await Promise.all((['telebirr','cbe'] as const).map(channel=>client.paymentPolicy.findFirst({where:{channel},orderBy:{version:'desc'}})));return {...paymentHealth(),accounts:policies.filter(p=>p?.enabled).map(p=>({id:p!.channel,policyId:p!.id,version:p!.version,name:p!.channel==='telebirr'?'Telebirr':'CBE',number:p!.account,holder:p!.accountName,numerator:p!.pointsNumerator.toString(),denominator:p!.centsDenominator.toString(),minCents:p!.minCents.toString(),maxCents:p!.maxCents.toString(),terms:p!.terms}))}}
export async function createIntent(client:PrismaClient,userId:string,raw:unknown){requireEnabled();const body=createSchema.parse(raw),fingerprint=hash(JSON.stringify(body));return client.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await eligibility(tx,userId);
 const prior=await tx.topUpIntent.findUnique({where:{userId_key:{userId,key:body.key}}});if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return ownIntent(prior)}
 const now=await clock(tx);if(await tx.topUpIntent.count({where:{userId,createdAt:{gte:new Date(now.getTime()-3600000)}}})>=8)throw new PaymentError(429,'Too many funding requests. Try later.');
 const policy=await tx.paymentPolicy.findFirst({where:{channel:body.channel},orderBy:{version:'desc'}});if(!policy?.enabled||policy.id!==body.policyId)throw new PaymentError(409,'The quote changed or channel is paused. Review the latest terms.');
 const amount=BigInt(body.amountCents),product=amount*policy.pointsNumerator;if(amount<policy.minCents||amount>policy.maxCents||product%policy.centsDenominator!==0n)throw new PaymentError(422,'Choose an amount within the published range that converts to whole points.');const points=product/policy.centsDenominator;if(points>1000000000n)throw new PaymentError(422,'Point amount is too large.');
 const t=await tx.topUpIntent.create({data:{userId,key:body.key,provider:'CHECK_ET',channel:body.channel,policyVersion:policy.id,requestHash:fingerprint,points,expectedCents:amount,receivingAccount:policy.account,accountName:policy.accountName,quoteSnapshot:{version:policy.version,numerator:policy.pointsNumerator.toString(),denominator:policy.centsDenominator.toString(),terms:policy.terms},createdAt:now,expiresAt:new Date(now.getTime()+30*60000)}});return ownIntent(t);
 })}
const verifySchema=z.object({id:z.string().uuid(),key:z.string().uuid(),input:z.string().min(1).max(4000)}).strict();
export async function verifyIntent(client:PrismaClient,userId:string,raw:unknown,transport:VerifyTransport=checkEt,reauthorize?:(tx:Tx)=>Promise<void>){
 requireEnabled();const body=verifySchema.parse(raw);
 const lease=await client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${body.id} FOR UPDATE`;const t=await tx.topUpIntent.findFirst({where:{id:body.id,userId}});if(!t||!t.channel)throw new PaymentError(404,'Funding request not found.');
  const reference=candidate(bankSchema.parse(t.channel),body.input),fingerprint=hash(reference),prior=await tx.paymentAttempt.findUnique({where:{intentId_key:{intentId:t.id,key:body.key}}});
  if(t.reference&&t.reference!==reference)throw new PaymentError(409,'This intent is bound to another reference.');if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return {receipt:ownIntent(t)}}
  if(t.status==='CREDITED')return {receipt:ownIntent(t)};
  const now=await clock(tx);if(!t.expiresAt||t.expiresAt<=now)throw new PaymentError(409,'This funding request expired. Contact support if you sent funds.');
  if(t.attempts>=6||['REJECTED','DUPLICATE_CONFLICT'].includes(t.status))throw new PaymentError(409,'Verification needs operator review.');if(t.nextAttemptAt>now||t.leaseUntil&&t.leaseUntil>now)throw new PaymentError(429,'Verification is pending. Wait before retrying.');
  await eligibility(tx,userId);const token=randomUUID();const current=await tx.topUpIntent.update({where:{id:t.id},data:{status:'VERIFYING',reference,attempts:{increment:1},leaseToken:token,leaseUntil:new Date(now.getTime()+30000)}});return {t:current,token,fingerprint,reference};
 });if('receipt' in lease)return lease.receipt!;
 // Deliberately outside any DB transaction. Only a short lease survives a crash.
 const {t,token,fingerprint,reference}=lease;const verified=await transport({bank:t.channel as Bank,reference,account:t.receivingAccount!,expectedCents:t.expectedCents!,createdAt:t.createdAt,expiresAt:t.expiresAt!});
 return client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${t.id} FOR UPDATE`;const current=await tx.topUpIntent.findUniqueOrThrow({where:{id:t.id}});if(current.status==='CREDITED')return ownIntent(current);if(current.leaseToken!==token)throw new PaymentError(409,'Verification was superseded. Refresh the request.');
  const now=await clock(tx);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${t.channel}:${reference}`},0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await eligibility(tx,userId);if(reauthorize)await reauthorize(tx);requireEnabled();
  let code=verified.code,matched=verified.matched;if(now>t.expiresAt!){code='STALE_INTENT';matched=false}
  const conflict=await tx.paymentClaim.findUnique({where:{channel_reference:{channel:t.channel!,reference}}});if(conflict){code='DUPLICATE_CONFLICT';matched=false}
  let journalId:string|undefined;
  if(matched){
   await ensureWallet(tx,userId);await seedPlatformAccounts(tx);const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});
   const operation=await tx.operation.create({data:{userId,scope:'TOPUP_CREDIT',key:t.id,requestHash:hash(`${t.id}:${reference}:${t.points}`),result:{intentId:t.id,credited:t.points.toString(),amountCents:t.expectedCents!.toString(),policyVersion:t.policyVersion}}});
   const journal=await tx.journal.create({data:{operationId:operation.id,kind:'TOPUP_CREDIT',reference:`topup:${t.id}`,postings:{create:[{accountId:issuance.id,delta:-t.points},{accountId:available.id,delta:t.points}]}}});journalId=journal.id;
   await tx.paymentClaim.create({data:{channel:t.channel!,reference,intentId:t.id,userId,amountCents:t.expectedCents!,points:t.points,receiverSuffix:verified.evidence.receiverSuffix!,transferredAt:new Date(verified.evidence.date!),operationId:operation.id,journalId,evidenceHash:verified.evidence.hash!}});
  }
  await tx.paymentAttempt.create({data:{intentId:t.id,key:body.key,requestHash:fingerprint,code,evidence:JSON.parse(JSON.stringify(verified.evidence)) as Prisma.InputJsonValue}});
  const status=matched?'CREDITED':code==='DUPLICATE_CONFLICT'?code:code.startsWith('PROVIDER_')?'PROVIDER_OUTAGE':['NOT_FOUND','UNCONFIRMED'].includes(code)?'PENDING':code==='INVALID_RECEIPT'?'REJECTED':'NEEDS_REVIEW';
  return ownIntent(await tx.topUpIntent.update({where:{id:t.id},data:{status,journalId,reasonCode:code,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(now.getTime()+Math.max(verified.retrySeconds??0,Math.min(900,30*2**current.attempts))*1000)}}));
 },{timeout:15000});
}
export async function listOwnTopups(client:PrismaClient,userId:string,page=1){const [rows,total]=await client.$transaction([client.topUpIntent.findMany({where:{userId,provider:'CHECK_ET'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,skip:(page-1)*20}),client.topUpIntent.count({where:{userId,provider:'CHECK_ET'}})]);return {items:rows.map(ownIntent),page,total,totalPages:Math.ceil(total/20)}}
export async function reconcilePayments(client:PrismaClient|Tx){return client.$queryRaw<{id:string}[]>`SELECT t.id FROM "TopUpIntent" t LEFT JOIN "PaymentClaim" c ON c."intentId"=t.id WHERE (t.status='CREDITED') IS DISTINCT FROM (c.id IS NOT NULL) OR c.id IS NOT NULL AND (c.points<>t.points OR c."journalId" IS DISTINCT FROM t."journalId" OR c."amountCents"<>t."expectedCents" OR c."userId"<>t."userId") UNION ALL SELECT j.id FROM "Journal" j LEFT JOIN "PaymentClaim" c ON c."journalId"=j.id WHERE j.kind='TOPUP_CREDIT' AND c.id IS NULL`}
