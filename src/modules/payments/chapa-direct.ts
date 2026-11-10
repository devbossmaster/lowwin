import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type ChapaCheckout,type BidBatchOrder} from '@prisma/client';
import {z} from 'zod';
import {etbToCents,centsToEtb} from '@/lib/money';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {decryptPhone,encryptPhone,normalizePhone,phoneHash,contactBotId} from '../auth/own-contact';
import {batchLines,ownBatch,normalizeBatchNumbers,persistBidBatchQuoteInTransaction,validateBatchInTransaction} from '../auctions/batch';
import {auctionMaintenance} from '../auctions/maintenance';
import {ChapaError,ChapaProviderError,chapaHash,chapaTransport,createdChapaDirect,requireChapa,type ChapaTransport} from './chapa-provider';
import {createDirectMethodCatalog,directMethodCatalog} from './chapa-direct-methods';
import {eligible,getChapaCheckout,ownChapaCheckout,verifyChapaCheckout} from './chapa';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {markChapaDispatch,measureChapa} from './chapa-timing';
import {classifyChapaApiError} from '@/lib/chapa-api-error';
import {paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';

type Authorize=(tx:Prisma.TransactionClient)=>Promise<void>;
const common={key:z.string().uuid(),paymentMethod:z.enum(['telebirr','mpesa','cbebirr','ebirr']),phone:z.string().min(9).max(40)};
const input=z.discriminatedUnion('purpose',[z.object({...common,purpose:z.literal('BID'),batchId:z.string().uuid(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({...common,purpose:z.literal('TOP_UP'),amount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)}).strict()]);
export function normalizePaymentPhone(value:string){let normalized:string;try{const compact=value.trim().replace(/[ ()-]/g,'');normalized=normalizePhone(/^[79]\d{8}$/.test(compact)?`+251${compact}`:compact)}catch{throw new ChapaError(422,'INVALID_PHONE','Enter a valid Ethiopian payment phone number.')}if(!/^\+251[79]\d{8}$/.test(normalized))throw new ChapaError(422,'INVALID_PHONE','Enter a valid Ethiopian payment phone number.');return normalized.slice(1)}
export function maskedPayerPhone(order:Pick<ChapaCheckout,'payerPhoneCipher'|'phoneBotId'>){try{const phone=decryptPhone(order.payerPhoneCipher!,order.phoneBotId!);return `${phone.slice(0,3)}*****${phone.slice(-4)}`}catch{return null}}
export async function directMethodsForUser(_client:PrismaClient,_userId:string,amountCents?:bigint){return {methods:await directMethodCatalog.get(amountCents)}}
const bidInput=z.object({...common,purpose:z.literal('BID'),auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),numbers:z.array(z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)).min(1).max(100),feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional(),approvedTotal:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)}).strict();
type DirectInput=z.infer<typeof input>;
const directRequestHash=(body:DirectInput,phone:string)=>chapaHash(JSON.stringify({...body,phone:phoneHash(`+${phone}`)}));
function assertDirectPhone(phone:string,method:string){const problem=paymentPhoneProblem(phone,method);if(problem)throw new ChapaError(422,'INVALID_PHONE',paymentPhoneProblemMessage(problem))}
async function capabilitiesFor(transport:ChapaTransport){return measureChapa('capabilities',()=>(transport===chapaTransport?directMethodCatalog:createDirectMethodCatalog(transport)).get())}
async function allowDirectCreation(tx:Prisma.TransactionClient,userId:string){if(!await allowIdentityRequest(tx,'direct-create',userId,24,3600000))throw new ChapaError(429,'RATE_LIMITED','Too many payment attempts. Check Transactions before trying again.')}
async function persistDirectIntent(tx:Prisma.TransactionClient,userId:string,body:DirectInput,phone:string,contact:{phoneCipher:string;botId:string},batch:BidBatchOrder|null,capabilities:Awaited<ReturnType<typeof capabilitiesFor>>,expected:ReturnType<typeof requireChapa>){
 const health=requireChapa();if(health.mode!==expected.mode||health.credentialFingerprint!==expected.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Review payment methods again before paying.');
 const amountCents=batch?.totalCents??etbToCents(body.purpose==='TOP_UP'?body.amount:'0'),method=capabilities.find(method=>method.slug===body.paymentMethod);
 if(amountCents<100n||amountCents>4320000n||!method||body.paymentMethod==='ebirr'&&process.env.CHAPA_DIRECT_EBIRR_ENABLED!=='true'||amountCents<BigInt(method.minimumCents)||amountCents>BigInt(method.maximumCents))throw new ChapaError(422,'METHOD_UNAVAILABLE','This method does not support the quoted amount. Choose an available wallet or payment method.');
 const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`,initialization={amountCents:String(amountCents),merchantReference,idempotencyKey:`lowwin-direct:${id}`,paymentMethod:body.paymentMethod,payerPhoneHash:phoneHash(`+${phone}`),...(batch?{batch:ownBatch(batch)}:{})};
 // Persist the initial replay bound and lease with creation, before HTTP.
 if(!await allowIdentityRequest(tx,'direct-initialize',id,5,86400000))throw new ChapaError(429,'RATE_LIMITED','Check the original payment before trying again.');
 return tx.chapaCheckout.create({data:{id,userId,key:body.key,requestHash:directRequestHash(body,phone),purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,initialization:JSON.parse(JSON.stringify(initialization)),chargeType:'DIRECT',flowVersion:2,batchId:batch?.id,payerPhoneCipher:encryptPhone(phone,contact.botId),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents,currency:'ETB',paymentMethod:body.paymentMethod,auctionId:batch?.auctionId,auctionSlug:batch?.auctionSlug,bidNumber:batch?new Prisma.Decimal(batchLines(batch)[0].number):null,feeVersion:batch?.feeVersion,grossFee:batch?new Prisma.Decimal(centsToEtb(batch.grossCents)):null,discountPoints:batch?new Prisma.Decimal(centsToEtb(batch.discountCents)):new Prisma.Decimal(0),couponId:batch?.couponId,status:'SUBMITTING',attempts:1,leaseUntil:new Date(Date.now()+45000),expiresAt:new Date(Date.now()+300000),nextCheckAt:new Date(Date.now()+15000),reconcileUntil:new Date(Date.now()+7*86400000)}});
}
/** One authenticated command prices and persists a bid before provider HTTP.
 * A different total returns an immutable quote without initiating a payment. */
export async function createBidDirectCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 const health=requireChapa(),body=bidInput.parse(raw),phone=normalizePaymentPhone(body.phone),numbers=normalizeBatchNumbers(body.numbers);
 const quoteInput={key:body.key,auctionSlug:body.auctionSlug,numbers,feeVersion:body.feeVersion,...(body.couponId?{couponId:body.couponId}:{})},quoteRequestHash=chapaHash(JSON.stringify(quoteInput));
 const assertReplay=(order:ChapaCheckout)=>{
  const snapshot=(order.initialization as Record<string,unknown>).batch as ReturnType<typeof ownBatch>|undefined;
  if(order.chargeType!=='DIRECT'||order.purpose!=='BID'||!order.batchId||!snapshot||snapshot.auctionSlug!==body.auctionSlug||snapshot.feeVersion!==body.feeVersion||order.couponId!==(body.couponId??null)||order.amountCents!==etbToCents(body.approvedTotal)||JSON.stringify(snapshot.lines.map(line=>line.number))!==JSON.stringify(numbers))throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');
  const legacy=input.parse({key:body.key,purpose:'BID',batchId:order.batchId,quoteHash:snapshot.quoteHash,paymentMethod:body.paymentMethod,phone:body.phone});
  if(order.requestHash!==directRequestHash(legacy,phone))throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');
 };
 const previous=await measureChapa('lookup',()=>client.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}}));
 if(previous){assertReplay(previous);return {kind:'payment' as const,order:await initializeDirectCheckout(client,previous,userId,reauthorize,transport)}}
 assertDirectPhone(phone,body.paymentMethod);const capabilities=await capabilitiesFor(transport);
 const prepared=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE slug=${body.auctionSlug} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  if(reauthorize)await reauthorize(tx);const contact=await eligible(tx,userId);
  const replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});if(replay){assertReplay(replay);return {kind:'replay' as const,order:replay}}
  const existing=await tx.bidBatchOrder.findUnique({where:{userId_key:{userId,key:body.key}}});
  if(existing&&existing.requestHash!==quoteRequestHash)throw new ChapaError(409,'KEY_REUSED','Changed selections require a new quote.');
  if(existing&&existing.status!=='QUOTED')throw new ChapaError(409,'PAYMENT_STARTED','Check the original payment.');
  if(existing&&await tx.chapaCheckout.findUnique({where:{batchId:existing.id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has a payment. Check the original payment.');
  const priced=await validateBatchInTransaction(tx,userId,body.auctionSlug,numbers,body.feeVersion,body.couponId);
  if(existing&&(existing.totalCents!==priced.totalCents||JSON.stringify(batchLines(existing))!==JSON.stringify(priced.lines)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review a new quote before paying.');
  const batch=existing??await persistBidBatchQuoteInTransaction(tx,userId,quoteInput,priced,quoteRequestHash);
  if(batch.totalCents!==etbToCents(body.approvedTotal))return {kind:'quote' as const,quote:ownBatch(batch)};
  await allowDirectCreation(tx,userId);
  const legacy=input.parse({key:body.key,purpose:'BID',batchId:batch.id,quoteHash:batch.quoteHash,paymentMethod:body.paymentMethod,phone:body.phone});
  return {kind:'created' as const,order:await persistDirectIntent(tx,userId,legacy,phone,contact,batch,capabilities,health)};
 },PAYMENT_TRANSACTION_OPTIONS));
 if(prepared.kind==='quote')return prepared;
 return {kind:'payment' as const,order:prepared.kind==='created'?await dispatchDirectCheckout(client,prepared.order,userId,transport):await initializeDirectCheckout(client,prepared.order,userId,reauthorize,transport)};
}
/** Persist first; a transport timeout always resumes this exact key/reference. */
export async function createDirectCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 const health=requireChapa(),body=input.parse(raw),phone=normalizePaymentPhone(body.phone),requestHash=directRequestHash(body,phone);
 const previous=await measureChapa('lookup',()=>client.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}}));
 if(previous){if(previous.requestHash!==requestHash||previous.chargeType!=='DIRECT')throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');return initializeDirectCheckout(client,previous,userId,reauthorize,transport)}
 assertDirectPhone(phone,body.paymentMethod);const capabilities=await capabilitiesFor(transport);
 const prepared=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  if(body.purpose==='BID')await tx.$queryRaw`SELECT a.id FROM "Auction" a JOIN "BidBatchOrder" b ON b."auctionId"=a.id WHERE b.id=${body.batchId} AND b."userId"=${userId} FOR UPDATE OF a`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  if(reauthorize)await reauthorize(tx);const contact=await eligible(tx,userId);
  const replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});if(replay){if(replay.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Retry the original payment details.');return {order:replay,created:false}}
  await allowDirectCreation(tx,userId);
  const batch=body.purpose==='BID'?await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}}):null;
  if(body.purpose==='BID'){
   if(!batch)throw new ChapaError(404,'NOT_FOUND','Order not found.');
   if(!batch||batch.quoteHash!==body.quoteHash||batch.status!=='QUOTED')throw new ChapaError(409,'TERMS_CHANGED','Review a new quote before paying.');
   if(await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has a payment. Check the original payment.');
   const priced=await validateBatchInTransaction(tx,userId,batch.auctionSlug,batchLines(batch).map(line=>line.number),batch.feeVersion,batch.couponId??undefined);
   if(priced.totalCents!==batch.totalCents||JSON.stringify(priced.lines)!==JSON.stringify(batchLines(batch)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review a new quote before paying.');
  }
  return {order:await persistDirectIntent(tx,userId,body,phone,contact,batch,capabilities,health),created:true};
 },PAYMENT_TRANSACTION_OPTIONS));
 return prepared.created?dispatchDirectCheckout(client,prepared.order,userId,transport):initializeDirectCheckout(client,prepared.order,userId,reauthorize,transport);
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
 const acquired=await measureChapa('prepare',()=>client.$transaction(async tx=>{if(reauthorize)await reauthorize(tx);if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused.');
  // Verification attempts must not exhaust initialization replay: a lost OTP
  // initialization response may need its original authorization data replayed.
  // Keep a separate durable, per-intent bound using the existing rate limiter.
  if(!await allowIdentityRequest(tx,'direct-initialize',order.id,5,86400000))return {count:0};
  return tx.chapaCheckout.updateMany({where:{id:order.id,creditJournalId:null,authorizationReference:null,OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:new Date(Date.now()+45000),nextCheckAt:new Date(Date.now()+15000),attempts:{increment:1}}})},PAYMENT_TRANSACTION_OPTIONS));
 if(!acquired.count)return getChapaCheckout(client,userId,order.id);
 return dispatchDirectCheckout(client,order,userId,transport);
}
/** Only a durably leased, owned intent reaches this helper. Provider HTTP is
 * outside the creation/lease transaction and cannot hold financial locks. */
async function dispatchDirectCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,transport:ChapaTransport){
 const health=requireChapa();if(order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Check this original payment with its original configuration.');
 const writable={id:order.id,userId,creditJournalId:null,authorizationReference:null,status:{in:['SUBMITTING','PENDING']},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']}} satisfies Prisma.ChapaCheckoutWhereInput;
 try{
  if(!transport.direct)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Direct payments are unavailable.');
  const initialization=order.initialization as Record<string,unknown>,request={amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),paymentMethod:order.paymentMethod!,phone:decryptPhone(order.payerPhoneCipher!,order.phoneBotId!)};
  markChapaDispatch();const raw=await measureChapa('initialize',()=>transport.direct!(request)),created=createdChapaDirect(raw);
  if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','We have not confirmed this payment yet. Check Transactions.');
  const authorization={authorizationReference:created.reference,providerRequestId:created.requestId,authType:created.authType,providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{})};
  const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{...authorization,status:'AUTH_NEEDED',leaseUntil:null,nextCheckAt:new Date(),initializationErrorCode:null,initializationHttpStatus:null}}));
  if(rows[0])return ownChapaCheckout(rows[0]);
  // A verified pending/auth-needed hint can race initialization. Preserve its
  // authoritative outcome and lease; add only the missing authorization data.
  // Never move a terminal, mismatched, or credited result back to pending.
  const pending=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:{id:order.id,userId,creditJournalId:null,authorizationReference:null,status:{in:['PENDING','AUTH_NEEDED','VERIFYING']},verificationState:'VERIFIED',providerStatus:{in:['PENDING','AUTH_NEEDED']}},data:authorization}));
  if(pending[0])return ownChapaCheckout(pending[0]);
 }catch(error){
  // HTTP validation errors describe the initialization request, not a verified
  // financial outcome. Unknown/temporary/conflicting replies remain recoverable.
  const rejected=error instanceof ChapaProviderError&&error.category==='request';
  const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{leaseUntil:null,status:rejected?'NEEDS_REVIEW':'PENDING',reason:rejected?'INITIALIZATION_REJECTED':'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',nextCheckAt:new Date(Date.now()+(rejected?300000:15000)),initializationErrorCode:error instanceof ChapaProviderError?error.paymentReason??error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null}}));
  if(rows[0])return ownChapaCheckout(rows[0]);
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
