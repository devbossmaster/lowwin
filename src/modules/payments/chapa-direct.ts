import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type ChapaCheckout} from '@prisma/client';
import {z} from 'zod';
import {etbToCents,centsToEtb} from '@/lib/money';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {decryptPhone,encryptPhone,normalizePhone,phoneHash,contactBotId} from '../auth/own-contact';
import {batchLines,ownBatch,validateBatchInTransaction} from '../auctions/batch';
import {auctionMaintenance} from '../auctions/maintenance';
import {ChapaError,ChapaProviderError,chapaHash,chapaTransport,createdChapaDirect,requireChapa,type ChapaTransport} from './chapa-provider';
import {createDirectMethodCatalog,directMethodCatalog} from './chapa-direct-methods';
import {eligible,getChapaCheckout,ownChapaCheckout,verifyChapaCheckout} from './chapa';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {measureChapa} from './chapa-timing';
import {classifyChapaApiError} from '@/lib/chapa-api-error';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';

type Authorize=(tx:Prisma.TransactionClient)=>Promise<void>;
const common={key:z.string().uuid(),paymentMethod:z.enum(['telebirr','mpesa','cbebirr','ebirr']),phone:z.string().min(9).max(40)};
const input=z.discriminatedUnion('purpose',[z.object({...common,purpose:z.literal('BID'),batchId:z.string().uuid(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({...common,purpose:z.literal('TOP_UP'),amount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)}).strict()]);
export function normalizePaymentPhone(value:string){let normalized:string;try{const compact=value.trim().replace(/[ ()-]/g,'');normalized=normalizePhone(/^[79]\d{8}$/.test(compact)?`+251${compact}`:compact)}catch{throw new ChapaError(422,'INVALID_PHONE','Enter a valid Ethiopian payment phone number.')}if(!/^\+251[79]\d{8}$/.test(normalized))throw new ChapaError(422,'INVALID_PHONE','Enter a valid Ethiopian payment phone number.');return normalized.slice(1)}
export function maskedPayerPhone(order:Pick<ChapaCheckout,'payerPhoneCipher'|'phoneBotId'>){try{const phone=decryptPhone(order.payerPhoneCipher!,order.phoneBotId!);return `${phone.slice(0,3)}*****${phone.slice(-4)}`}catch{return null}}
export async function directMethodsForUser(_client:PrismaClient,_userId:string,amountCents?:bigint){return {methods:await directMethodCatalog.get(amountCents)}}
/** Persist first; a transport timeout always resumes this exact key/reference. */
export async function createDirectCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 const health=requireChapa(),body=input.parse(raw),phone=normalizePaymentPhone(body.phone),requestHash=chapaHash(JSON.stringify({...body,phone:phoneHash(`+${phone}`)}));
 const previous=await client.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
 if(previous){if(previous.requestHash!==requestHash||previous.chargeType!=='DIRECT')throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');return initializeDirectCheckout(client,previous,userId,reauthorize,transport)}
 const phoneProblem=paymentPhoneProblem(phone,body.paymentMethod);
 if(phoneProblem)throw new ChapaError(422,'INVALID_PHONE',paymentPhoneProblemMessage(phoneProblem));
 const capabilities=await (transport===chapaTransport?directMethodCatalog:createDirectMethodCatalog(transport)).get();
 const order=await measureChapa('database',()=>client.$transaction(async tx=>{
  if(body.purpose==='BID'){const snapshot=await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}});if(!snapshot)throw new ChapaError(404,'NOT_FOUND','Order not found.');await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${snapshot.auctionId} FOR UPDATE`}
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  if(reauthorize)await reauthorize(tx);const contact=await eligible(tx,userId);
  const replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});if(replay){if(replay.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');return replay}
  if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  if(!await allowIdentityRequest(tx,'direct-create',userId,24,3600000))throw new ChapaError(429,'RATE_LIMITED','Too many payment attempts. Check Transactions before trying again.');
  const batch=body.purpose==='BID'?await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}}):null;
  if(body.purpose==='BID'){
   if(!batch||batch.quoteHash!==body.quoteHash||batch.status!=='QUOTED')throw new ChapaError(409,'TERMS_CHANGED','Review a new quote before paying.');
   if(await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has a payment. Check the original payment.');
   const priced=await validateBatchInTransaction(tx,userId,batch.auctionSlug,batchLines(batch).map(line=>line.number),batch.feeVersion,batch.couponId??undefined);
   if(priced.totalCents!==batch.totalCents||JSON.stringify(priced.lines)!==JSON.stringify(batchLines(batch)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review a new quote before paying.');
  }
  const amountCents=batch?.totalCents??etbToCents(body.purpose==='TOP_UP'?body.amount:'0'),method=capabilities.find(method=>method.slug===body.paymentMethod);
  if(amountCents<100n||amountCents>4320000n||!method||amountCents<BigInt(method.minimumCents)||amountCents>BigInt(method.maximumCents))throw new ChapaError(422,'METHOD_UNAVAILABLE','This method does not support the quoted amount. Choose an available wallet or payment method.');
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`,initialization={amountCents:String(amountCents),merchantReference,idempotencyKey:`lowwin-direct:${id}`,paymentMethod:body.paymentMethod,payerPhoneHash:phoneHash(`+${phone}`),...(batch?{batch:ownBatch(batch)}:{})};
  return tx.chapaCheckout.create({data:{id,userId,key:body.key,requestHash,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,initialization:JSON.parse(JSON.stringify(initialization)),chargeType:'DIRECT',flowVersion:2,batchId:batch?.id,payerPhoneCipher:encryptPhone(phone,contact.botId),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents,currency:'ETB',paymentMethod:body.paymentMethod,auctionId:batch?.auctionId,auctionSlug:batch?.auctionSlug,bidNumber:batch?new Prisma.Decimal(batchLines(batch)[0].number):null,feeVersion:batch?.feeVersion,grossFee:batch?new Prisma.Decimal(centsToEtb(batch.grossCents)):null,discountPoints:batch?new Prisma.Decimal(centsToEtb(batch.discountCents)):new Prisma.Decimal(0),couponId:batch?.couponId,status:'SUBMITTING',expiresAt:new Date(Date.now()+300000),nextCheckAt:new Date(),reconcileUntil:new Date(Date.now()+7*86400000)}});
 },PAYMENT_TRANSACTION_OPTIONS));
 return initializeDirectCheckout(client,order,userId,reauthorize,transport);
}
export async function initializeDirectCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 if(order.userId!==userId)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 const health=requireChapa();if(order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Check this original payment with its original configuration.');
 if(order.creditJournalId||order.authorizationReference)return ownChapaCheckout(order);
 // A structured validation rejection did not initialize this immutable request.
 // Keep its record, and require an explicit corrected attempt rather than
 // repeatedly sending the rejected phone/method under the original key.
 if(classifyChapaApiError(order.initializationHttpStatus,order.initializationErrorCode)==='request')return getChapaCheckout(client,userId,order.id);
 // An old unknown intent is reconciled by reference, never blindly re-created.
 if(Date.now()-order.createdAt.getTime()>86400000)return verifyChapaCheckout(client,order.id,userId,reauthorize,transport,true);
 const acquired=await client.$transaction(async tx=>{if(reauthorize)await reauthorize(tx);if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused.');
  // Verification attempts must not exhaust initialization replay: a lost OTP
  // initialization response may need its original authorization data replayed.
  // Keep a separate durable, per-intent bound using the existing rate limiter.
  if(!await allowIdentityRequest(tx,'direct-initialize',order.id,5,86400000))return {count:0};
  return tx.chapaCheckout.updateMany({where:{id:order.id,creditJournalId:null,authorizationReference:null,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:new Date(Date.now()+45000),nextCheckAt:new Date(Date.now()+15000),attempts:{increment:1}}})},PAYMENT_TRANSACTION_OPTIONS);
 if(!acquired.count)return getChapaCheckout(client,userId,order.id);
 try{
  if(!transport.direct)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Direct payments are unavailable.');
  const initialization=order.initialization as Record<string,unknown>,raw=await measureChapa('initialize',()=>transport.direct!({amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),paymentMethod:order.paymentMethod!,phone:decryptPhone(order.payerPhoneCipher!,order.phoneBotId!)})),created=createdChapaDirect(raw);
  if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','We have not confirmed this payment yet. Check Transactions.');
  await client.chapaCheckout.updateMany({where:{id:order.id,creditJournalId:null,authorizationReference:null},data:{authorizationReference:created.reference,providerRequestId:created.requestId,authType:created.authType,status:'AUTH_NEEDED',providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{}),leaseUntil:null,nextCheckAt:new Date(),initializationErrorCode:null,initializationHttpStatus:null}});
 }catch(error){
  // HTTP validation errors describe the initialization request, not a verified
  // financial outcome. Unknown/temporary/conflicting replies remain recoverable.
  const rejected=error instanceof ChapaProviderError&&error.category==='request';
  await client.chapaCheckout.updateMany({where:{id:order.id,creditJournalId:null,authorizationReference:null},data:{leaseUntil:null,status:rejected?'NEEDS_REVIEW':'PENDING',reason:rejected?'INITIALIZATION_REJECTED':'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',nextCheckAt:new Date(Date.now()+(rejected?300000:15000)),initializationErrorCode:error instanceof ChapaProviderError?error.paymentReason??error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null}});
 }
 return getChapaCheckout(client,userId,order.id);
}
/** OTP lives only in this stack frame. Never retry this mutation automatically. */
export async function authorizeDirectCheckout(client:PrismaClient,userId:string,id:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 requireChapa('recover');z.string().uuid().parse(id);const body=z.object({otp:z.string().regex(/^\d{4,10}$/).optional()}).strict().parse(raw),order=await client.chapaCheckout.findFirst({where:{id,userId,chargeType:'DIRECT'}});if(!order)throw new ChapaError(404,'NOT_FOUND','Payment not found.');if(order.creditJournalId)return ownChapaCheckout(order);
 const health=requireChapa('recover');if(order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','This payment needs its original configuration.');
 if(['FAILED','CANCELLED','INCOMPLETE','BLOCKED','EXPIRED'].includes(order.status))return verifyChapaCheckout(client,id,userId,reauthorize,transport,true);
 if(order.validationAttempts>=20)throw new ChapaError(429,'AUTHORIZATION_LIMIT','Too many authorization attempts. Check this original payment in Transactions.');
 if(!order.authorizationReference||!order.authType)throw new ChapaError(409,'PAYMENT_INITIALIZING','Check the original payment while it is being initialized.');
 if(order.authType==='OTP'&&!body.otp||order.authType!=='OTP'&&body.otp)throw new ChapaError(422,'INVALID_AUTHORIZATION','Follow the authorization method requested for this payment.');
 const acquired=await client.$transaction(async tx=>{if(reauthorize)await reauthorize(tx);if(!await allowIdentityRequest(tx,'chapa-validate',`${userId}:${id}`,5))throw new ChapaError(429,'RATE_LIMITED','Wait a minute before trying authorization again.');return tx.chapaCheckout.updateMany({where:{id,creditJournalId:null,validationAttempts:{lt:20},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:new Date(Date.now()+20000),validationAttempts:{increment:1}}})},PAYMENT_TRANSACTION_OPTIONS);
 if(!acquired.count)return getChapaCheckout(client,userId,id);
 try{if(order.authType==='OTP'){if(!transport.validate)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Payment authorization is unavailable.');await transport.validate({reference:order.authorizationReference,paymentMethod:order.paymentMethod!,otp:body.otp})}}
 finally{await client.chapaCheckout.updateMany({where:{id,creditJournalId:null},data:{leaseUntil:null,nextCheckAt:new Date()}})}
 return verifyChapaCheckout(client,id,userId,reauthorize,transport,true);
}
export async function reconcileDirectCheckouts(client:PrismaClient,limit=10,transport:ChapaTransport=chapaTransport){const health=requireChapa('recover'),rows=await client.chapaCheckout.findMany({where:{chargeType:'DIRECT',mode:health.mode,credentialFingerprint:health.credentialFingerprint!,creditJournalId:null,reconcileUntil:{gt:new Date()},nextCheckAt:{lte:new Date()},attempts:{lt:500},status:{in:['SUBMITTING','PENDING','AUTH_NEEDED','VERIFYING','NEEDS_REVIEW']}},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id,undefined,undefined,transport);checked++}catch{/* Durable intent remains recoverable without disclosing provider/contact data. */}}return {checked}}
