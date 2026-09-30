import {materializeAlert} from '../notifications/service';
import {assertPlayerContact} from '../auth/own-contact';
import {liveFundingConfigured} from './activation';
import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type TopUpIntent} from '@prisma/client';
import {z} from 'zod';
import {demoBidAllowed} from '../auctions/bids';
import {ensureWallet,seedPlatformAccounts} from '../wallet/ledger';
import {bankSchema,candidate,submitVerify,readVerifyStatus,assess,hash,PaymentError,type VerifyTransport,type Bank,type Verification,type VerificationInput} from './provider';
import {CUSTOMER_ATTEMPTS,STAFF_ATTEMPTS,RECOVERY_WINDOW_MS,protectedPayment,retryDetails} from './retry';
type Tx=Prisma.TransactionClient;
export function paymentHealth(){
 const productionEnabled=liveFundingConfigured();
 const isolated=demoBidAllowed(),configured=productionEnabled||isolated&&!!process.env.VERIFY_ET_API_KEY&&!!process.env.VERIFY_ET_TEST_ENDPOINT&&process.env.PAYMENTS_TEST_ENABLED==='true';
 return {enabled:configured,productionEnabled,ocr:configured&&process.env.RECEIPT_OCR==='tesseract',reason:productionEnabled?'Only exact provider-verified transfers can credit your wallet.':configured?'Isolated test verification only. Do not send real funds.':'Adding ETB is unavailable until receiving accounts and verification are reviewed.'};
}
function requireEnabled(){if(!paymentHealth().enabled)throw new PaymentError(503,paymentHealth().reason)}
async function clock(tx:Tx){return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now}
async function eligibility(tx:Tx,userId:string){try{await assertPlayerContact(tx,userId)}catch{throw new PaymentError(403,'Share your own contact in Telegram first.')}if(await tx.staffMember.findUnique({where:{userId}})||await tx.userRestriction.findFirst({where:{userId,suspended:true}}))throw new PaymentError(403,'Adding ETB is unavailable for this account.')}
const int=z.string().regex(/^[1-9]\d{0,10}$/);
const createSchema=z.object({key:z.string().uuid(),channel:bankSchema,policyId:z.string().uuid(),amountCents:int}).strict();
const receiptCreateSchema=z.object({key:z.string().uuid(),channel:bankSchema,policyId:z.string().uuid(),input:z.string().min(1).max(4000).optional()}).strict();
async function existingDeposit(tx:Tx,userId:string,channel:string,reference:string){
 const claim=await tx.paymentClaim.findUnique({where:{channel_reference:{channel,reference}}});
 if(claim?.userId===userId)return tx.topUpIntent.findUnique({where:{id:claim.intentId}});
 return tx.topUpIntent.findFirst({where:{userId,provider:{in:['CHECK_ET','VERIFY_ET']},channel,reference},orderBy:[{createdAt:'asc'},{id:'asc'}]});
}
export function ownIntent(t:TopUpIntent){return {id:t.id,demo:t.provider==='DEMO_PREVIEW',channel:t.channel,status:t.status,amountCents:t.expectedCents?.toString(),points:t.points.toString(),policyVersion:t.policyVersion,quote:t.quoteSnapshot,account:t.receivingAccount,accountName:t.accountName,createdAt:t.createdAt.toISOString(),expiresAt:t.expiresAt?.toISOString(),reference:t.reference,reason:t.reasonCode,attempts:t.attempts,caseState:t.caseState,...retryDetails(t)};}
// Store only customer outcome fields in redacted immutable attempt evidence.
function attemptResult(t:ReturnType<typeof ownIntent>){const {status,points,amountCents,reason,attempts,nextAttemptAt,caseState,canRetry,retryBlocked,retryUntil}=t;return JSON.parse(JSON.stringify({status,points,amountCents,reason,attempts,nextAttemptAt,caseState,canRetry,retryBlocked,retryUntil})) as Prisma.InputJsonObject;}
export async function fundingOptions(client:PrismaClient){const policies=await Promise.all((['telebirr','cbe'] as const).map(channel=>client.paymentPolicy.findFirst({where:{channel},orderBy:{version:'desc'}})));return {...paymentHealth(),accounts:policies.filter(p=>p?.enabled&&p.pointsNumerator*100n===p.centsDenominator).map(p=>({id:p!.channel,policyId:p!.id,version:p!.version,name:p!.channel==='telebirr'?'Telebirr':'CBE',number:p!.account,holder:p!.accountName,numerator:p!.pointsNumerator.toString(),denominator:p!.centsDenominator.toString(),minCents:p!.minCents.toString(),maxCents:p!.maxCents.toString(),terms:p!.terms}))}}
export async function createIntent(client:PrismaClient,userId:string,raw:unknown,fromReceipt=false){requireEnabled();const body=fromReceipt?receiptCreateSchema.parse(raw):createSchema.parse(raw),fingerprint=hash(JSON.stringify({...body,...(fromReceipt?{amountFromReceipt:true}:{})}));return client.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await eligibility(tx,userId);
 const prior=await tx.topUpIntent.findUnique({where:{userId_key:{userId,key:body.key}}});if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return ownIntent(prior)}
 const reference=fromReceipt&&'input' in body&&body.input?candidate(body.channel,body.input):undefined;
 if(reference){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-submit:${userId}:${body.channel}:${reference}`},0))`;const existing=await existingDeposit(tx,userId,body.channel,reference);if(existing)return {...ownIntent(existing),reused:true}}
 const now=await clock(tx);if(await tx.topUpIntent.count({where:{userId,createdAt:{gte:new Date(now.getTime()-3600000)}}})>=8)throw new PaymentError(429,'Too many funding requests. Try later.');
 const policy=await tx.paymentPolicy.findFirst({where:{channel:body.channel},orderBy:{version:'desc'}});if(!policy?.enabled||policy.id!==body.policyId)throw new PaymentError(409,'The quote changed or channel is paused. Review the latest terms.');
 if(policy.pointsNumerator*100n!==policy.centsDenominator)throw new PaymentError(409,'This quote uses an old conversion rate. Ask an Owner to publish the ETB 1:1 quote.');
 const amount=fromReceipt?null:BigInt(createSchema.parse(raw).amountCents);
 if(amount!==null&&(amount<policy.minCents||amount>policy.maxCents))throw new PaymentError(422,'Choose an amount within the published range.');const points=new Prisma.Decimal(amount?.toString()??'0').div(100);if(points.gt(1000000000))throw new PaymentError(422,'ETB amount is too large.');
 // Freeze a bounded receipt submission window, never before this policy existed.
 const earliestTransferAt=new Date(Math.max(policy.createdAt.getTime(),now.getTime()-86400000));
 const t=await tx.topUpIntent.create({data:{userId,key:body.key,provider:'VERIFY_ET',channel:body.channel,reference,policyVersion:policy.id,requestHash:fingerprint,points,expectedCents:amount,amountFromReceipt:fromReceipt,receivingAccount:policy.account,accountName:policy.accountName,quoteSnapshot:{version:policy.version,numerator:policy.pointsNumerator.toString(),denominator:policy.centsDenominator.toString(),terms:policy.terms,...(fromReceipt?{minCents:policy.minCents.toString(),maxCents:policy.maxCents.toString(),earliestTransferAt:earliestTransferAt.toISOString()}:{})},createdAt:now,expiresAt:new Date(now.getTime()+30*60000)}});return ownIntent(t);
 })}
export async function verifyIntent(client:PrismaClient,userId:string,raw:unknown,transport:VerifyTransport=submitVerify,reauthorize?:(tx:Tx)=>Promise<void>,adminRecovery=false,staffRetry=false){
 return verifyQueuedIntent(client,userId,raw,transport,reauthorize,adminRecovery,staffRetry);
}
const verifySchema=z.object({id:z.string().uuid(),key:z.string().uuid(),input:z.string().min(1).max(4000)}).strict();
function inputFor(t:TopUpIntent,key:string):VerificationInput{
 const quote=t.quoteSnapshot as {minCents?:string;maxCents?:string;earliestTransferAt?:string}|null;
 return {bank:bankSchema.parse(t.channel),reference:t.reference!,account:t.receivingAccount!,expectedCents:t.expectedCents,createdAt:t.amountFromReceipt?new Date(quote?.earliestTransferAt??''):t.createdAt,expiresAt:t.expiresAt!,attemptKey:key,...(t.amountFromReceipt?{minCents:BigInt(quote?.minCents??'0'),maxCents:BigInt(quote?.maxCents??'0')}:{})};
}
async function verifyQueuedIntent(client:PrismaClient,userId:string,raw:unknown,transport:VerifyTransport,reauthorize?:(tx:Tx)=>Promise<void>,adminRecovery=false,staffRetry=false){
 requireEnabled();const body=verifySchema.parse(raw);
 const started=await client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${body.id} FOR UPDATE`;
  const t=await tx.topUpIntent.findFirst({where:{id:body.id,userId}});
  if(!t||!t.channel||!['CHECK_ET','VERIFY_ET'].includes(t.provider))throw new PaymentError(404,'Funding request not found.');
  const reference=candidate(bankSchema.parse(t.channel),body.input),fingerprint=hash(reference);
  if(t.reference&&t.reference!==reference)throw new PaymentError(409,'This deposit is bound to another reference.');
  if(t.status==='CREDITED')return {receipt:{...ownIntent(t),reused:true}};
  const prior=await tx.paymentAttempt.findUnique({where:{intentId_key:{intentId:t.id,key:body.key}}});
  if(prior){if(prior.requestHash!==fingerprint)throw new PaymentError(409,'Idempotency key changed.');return {receipt:ownIntent(t)}}
  const sameKey=await tx.verifyRequest.findUnique({where:{key:body.key}});
  if(sameKey){if(sameKey.intentId!==t.id||sameKey.reference!==reference)throw new PaymentError(409,'Idempotency key changed.');return {receipt:ownIntent(t)}}
  const active=await tx.verifyRequest.findFirst({where:{intentId:t.id,state:{in:['SUBMITTING','PROCESSING']}},orderBy:{createdAt:'desc'}});
  if(active)return {receipt:ownIntent(t)};
  const now=await clock(tx);
  if(protectedPayment(t))throw new PaymentError(409,'This deposit is protected or rejected. Contact support.');
  if(!t.expiresAt||now.getTime()>t.expiresAt.getTime()+RECOVERY_WINDOW_MS)throw new PaymentError(409,'The recovery window ended. Contact support with this deposit ID.');
  if(t.attempts>=(adminRecovery||staffRetry?STAFF_ATTEMPTS:CUSTOMER_ATTEMPTS))throw new PaymentError(409,'Verification needs operator review.');
  if(t.nextAttemptAt>now)throw new PaymentError(429,'Verification is pending. Wait before retrying.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-submit:${userId}:${t.channel}:${reference}`},0))`;
  const existing=await existingDeposit(tx,userId,t.channel,reference);
  if(existing&&existing.id!==t.id){if(!t.reference&&t.attempts===0)await tx.topUpIntent.update({where:{id:t.id},data:{status:'REJECTED',reasonCode:'DUPLICATE_REQUEST',caseState:'ARCHIVED'}});return {receipt:{...ownIntent(existing),reused:true}}}
  const claim=await tx.paymentClaim.findUnique({where:{channel_reference:{channel:t.channel,reference}}});
  if(claim){if(claim.userId===userId)return {receipt:{...ownIntent(await tx.topUpIntent.findUniqueOrThrow({where:{id:claim.intentId}})),reused:true}};throw new PaymentError(409,'This transfer was already credited.')}
  await eligibility(tx,userId);if(reauthorize)await reauthorize(tx);
  const request=await tx.verifyRequest.create({data:{intentId:t.id,key:body.key,reference,state:'SUBMITTING',nextCheckAt:new Date(now.getTime()+60000)}});
  const current=await tx.topUpIntent.update({where:{id:t.id},data:{status:'VERIFYING',reasonCode:'PROCESSING',reference,attempts:{increment:1},nextAttemptAt:new Date(now.getTime()+5000)}});
  return {requestId:request.id,t:current};
 });
 if('receipt' in started)return started.receipt!;
 const verified=await transport(inputFor(started.t,body.key));
 return completeVerifyRequest(client,started.requestId,verified,reauthorize);
}

async function completeVerifyRequest(client:PrismaClient,id:string,verified:Verification,reauthorize?:(tx:Tx)=>Promise<void>){
 return client.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "VerifyRequest" WHERE id=${id} FOR UPDATE`;
  const request=await tx.verifyRequest.findUniqueOrThrow({where:{id}});
  await tx.$queryRaw`SELECT id FROM "TopUpIntent" WHERE id=${request.intentId} FOR UPDATE`;
  const t=await tx.topUpIntent.findUniqueOrThrow({where:{id:request.intentId}});
  if(request.state==='DONE'||t.status==='CREDITED')return ownIntent(t);
  if(request.requestId&&verified.requestId&&request.requestId!==verified.requestId)throw new PaymentError(409,'Provider request identity changed.');
  const providerId=verified.requestId??request.requestId;
  if(providerId&&request.requestId!==providerId){
   await tx.verifyRequest.update({where:{id},data:{requestId:providerId}});
   const early=await tx.verifyWebhookEvent.findFirst({where:{requestId:providerId,processedAt:null}});
   if(early&&verified.processing)verified={...verified,retrySeconds:1};
  }
  const now=await clock(tx);
  if(verified.processing||['PROVIDER_OUTAGE','PROVIDER_RATE_LIMIT'].includes(verified.code)){
   const delay=verified.retrySeconds??(verified.processing?5:30);
   await tx.verifyRequest.update({where:{id},data:{state:providerId?'PROCESSING':'SUBMITTING',nextCheckAt:new Date(now.getTime()+delay*1000),code:verified.code}});
   const updated=await tx.topUpIntent.update({where:{id:t.id},data:{status:'VERIFYING',reasonCode:verified.code,nextAttemptAt:new Date(now.getTime()+delay*1000)}});
   return ownIntent(updated);
  }
  let code=verified.code,matched=verified.matched;
  if(matched&&!providerId){matched=false;code='REQUEST_ID_MISSING'}
  if(protectedPayment(t)||!t.expiresAt||now.getTime()>t.expiresAt.getTime()+RECOVERY_WINDOW_MS){matched=false;code='STALE_OR_PROTECTED'}
  if(matched){await eligibility(tx,t.userId);if(reauthorize)await reauthorize(tx);requireEnabled()}
  const quote=t.quoteSnapshot as {minCents?:string;maxCents?:string}|null;
  const amount=t.amountFromReceipt&&verified.evidence.amountCents?BigInt(verified.evidence.amountCents):t.expectedCents;
  const points=t.amountFromReceipt?new Prisma.Decimal(amount?.toString()??'0').div(100):t.points;
  if(matched&&(!amount||points.lte(0)||points.gt(1000000000)||t.amountFromReceipt&&(amount<BigInt(quote?.minCents??'0')||amount>BigInt(quote?.maxCents??'0')))){matched=false;code='AMOUNT_MISMATCH'}
  const channel=t.channel!,rawAliases=[request.reference,...(verified.evidence.aliases??[])];
  const aliases=[...new Set(rawAliases.map(value=>candidate(bankSchema.parse(channel),value)))].sort();
  if(matched){
   for(const alias of aliases)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${channel}:${alias}`},0))`;
   const [claim,alias]=await Promise.all([tx.paymentClaim.findFirst({where:{channel,reference:{in:aliases}}}),tx.paymentTransferAlias.findFirst({where:{channel,alias:{in:aliases}}})]);
   if(claim||alias){matched=false;code='DUPLICATE_CONFLICT'}
  }
  let journalId:string|undefined;
  if(matched){
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${t.userId}`},0))`;
   await ensureWallet(tx,t.userId);await seedPlatformAccounts(tx);
   const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${t.userId}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});
   const operation=await tx.operation.create({data:{userId:t.userId,scope:'TOPUP_CREDIT',key:t.id,requestHash:hash(`${t.id}:${request.reference}:${points}`),result:{intentId:t.id,credited:points.toString(),amountCents:amount!.toString(),policyVersion:t.policyVersion}}});
   const journal=await tx.journal.create({data:{operationId:operation.id,kind:'TOPUP_CREDIT',reference:`topup:${t.id}`,postings:{create:[{accountId:issuance.id,delta:points.negated()},{accountId:available.id,delta:points}]}}});journalId=journal.id;
   const claim=await tx.paymentClaim.create({data:{channel,reference:request.reference,intentId:t.id,userId:t.userId,amountCents:amount!,points,receiverSuffix:verified.evidence.receiverSuffix!,transferredAt:new Date(verified.evidence.date!),operationId:operation.id,journalId,evidenceHash:verified.evidence.hash!}});
   await tx.paymentTransferAlias.createMany({data:aliases.map(alias=>({channel,alias,claimId:claim.id}))});
  }
  const status=matched?'CREDITED':code==='DUPLICATE_CONFLICT'?code:['UNCONFIRMED','NOT_FOUND'].includes(code)?'PENDING':'NEEDS_REVIEW';
  const updated=await tx.topUpIntent.update({where:{id:t.id},data:{status,journalId,...(matched?{caseState:'RESOLVED',assignedTo:null}:{}),...(matched&&t.amountFromReceipt?{expectedCents:amount,points}:{}),reasonCode:code,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(now.getTime()+Math.min(900,30*2**t.attempts)*1000)}});
  await tx.paymentAttempt.create({data:{intentId:t.id,key:request.key,requestHash:hash(request.reference),code,evidence:{amountCents:verified.evidence.amountCents??null,receiverSuffix:verified.evidence.receiverSuffix??null,date:verified.evidence.date??null,hash:verified.evidence.hash??null,aliasCount:aliases.length,invalidFields:verified.evidence.invalidFields??[],result:attemptResult(ownIntent(updated))}}});
  await tx.verifyRequest.update({where:{id},data:{state:'DONE',code}});
  if(providerId)await tx.verifyWebhookEvent.updateMany({where:{requestId:providerId,processedAt:null},data:{processedAt:now}});
  if(matched){const row=await tx.outbox.create({data:{key:`deposit:${t.id}:credited`,kind:'DEPOSIT_CREDITED',payload:{intentId:t.id,recipientUserId:t.userId}}});await materializeAlert(tx,row)}
  return ownIntent(updated);
 },{timeout:15000});
}

export async function processOneVerifyRequest(client:PrismaClient){
 if(!paymentHealth().enabled)return false;
 const row=await client.$transaction(async tx=>{
  const ids=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "VerifyRequest" WHERE state IN ('SUBMITTING','PROCESSING') AND "nextCheckAt"<=clock_timestamp() ORDER BY "nextCheckAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
  if(!ids[0])return null;
  return tx.verifyRequest.update({where:{id:ids[0].id},data:{nextCheckAt:new Date(Date.now()+60000),attempts:{increment:1}}});
 });
 if(!row)return false;
 const t=await client.topUpIntent.findUniqueOrThrow({where:{id:row.intentId}});
 if(t.status==='CREDITED'){await client.verifyRequest.update({where:{id:row.id},data:{state:'DONE',code:'ALREADY_CREDITED'}});return true}
 if(row.attempts>30){await completeVerifyRequest(client,row.id,{code:'PROVIDER_UNAVAILABLE',matched:false,requestId:row.requestId??undefined,evidence:{}});return true}
 let result:Verification|undefined;
 if(row.requestId){try{const status=await readVerifyStatus(row.requestId) as {data?:{processingStatus?:string}};if(status.data?.processingStatus==='queued'||status.data?.processingStatus==='running')result={code:'PROCESSING',matched:false,processing:true,requestId:row.requestId,evidence:{}}}catch{/* Replay the same immutable key. */}}
 if(!result)result=await submitVerify(inputFor(t,row.key));
 await completeVerifyRequest(client,row.id,result);return true;
}
export async function listOwnTopups(client:PrismaClient,userId:string,page=1){const [rows,total]=await client.$transaction([client.topUpIntent.findMany({where:{userId,provider:{in:['CHECK_ET','VERIFY_ET','DEMO_PREVIEW']},OR:[{reasonCode:null},{reasonCode:{not:'DUPLICATE_REQUEST'}}]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,skip:(page-1)*20}),client.topUpIntent.count({where:{userId,provider:{in:['CHECK_ET','VERIFY_ET','DEMO_PREVIEW']},OR:[{reasonCode:null},{reasonCode:{not:'DUPLICATE_REQUEST'}}]}})]);return {items:rows.map(ownIntent),page,total,totalPages:Math.ceil(total/20)}}
export async function reconcilePayments(client:PrismaClient|Tx){return client.$queryRaw<{id:string}[]>`SELECT t.id FROM "TopUpIntent" t LEFT JOIN "PaymentClaim" c ON c."intentId"=t.id WHERE (t.status='CREDITED') IS DISTINCT FROM (c.id IS NOT NULL) OR c.id IS NOT NULL AND (c.points<>t.points OR c."journalId" IS DISTINCT FROM t."journalId" OR c."amountCents"<>t."expectedCents" OR c."userId"<>t."userId") UNION ALL SELECT j.id FROM "Journal" j LEFT JOIN "PaymentClaim" c ON c."journalId"=j.id WHERE j.kind='TOPUP_CREDIT' AND c.id IS NULL`}
