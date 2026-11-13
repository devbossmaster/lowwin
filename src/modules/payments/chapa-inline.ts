import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type ChapaCheckout} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {CHAPA_TOPUP_MIN_CENTS,CHAPA_TOPUP_MIN_ETB,CHAPA_TOPUP_MAX_CENTS,CHAPA_TOPUP_MAX_ETB} from '@/lib/chapa-topup-policy';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {normalizePaymentPhone,paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {classifyChapaApiError} from '@/lib/chapa-api-error';
import {decryptPhone,encryptPhone,phoneHash} from '../auth/own-contact';
import {batchLines,ownBatch,validateBatchInTransaction} from '../auctions/batch';
import {auctionMaintenance} from '../auctions/maintenance';
import {eligible,getChapaCheckout,ownChapaCheckout,verifyChapaCheckout} from './chapa';
import {ChapaError,ChapaProviderError,chapaAvailability,chapaHash,createdChapaDirect,createdChapaSession,type ChapaCreate} from './chapa-provider';
import {chapaInlineAvailability,chapaInlineTransport,createInlineMethodCatalog,inlineMethodCatalog,inlineTransportBinding,isV2InlineCheckout,requireChapaInline,type ChapaInlineTransport} from './chapa-inline-provider';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {markChapaDispatch,measureChapa} from './chapa-timing';
import {depositBonusStorageReady,getDepositBonusPolicy,quoteDepositBonusInTransaction} from '../wallet/deposit-bonus';

type Authorize=(tx:Prisma.TransactionClient)=>Promise<void>;
const common={key:z.string().uuid(),flow:z.enum(['INLINE','HOSTED']),paymentMethod:z.enum(['telebirr','cbebirr','mpesa','ebirr','cbe-bank']),phone:z.string().min(9).max(40)};
const input=z.discriminatedUnion('purpose',[z.object({...common,purpose:z.literal('BID'),batchId:z.string().uuid(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({...common,purpose:z.literal('TOP_UP'),amount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/),approvedDepositBonusVersion:z.number().int().nonnegative().optional(),approvedDepositBonusAmount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/).optional()}).strict()]);
type InlineInput=z.infer<typeof input>;
const requestHash=(body:InlineInput,phone:string)=>chapaHash(JSON.stringify({...body,...(body.purpose==='TOP_UP'?{amount:centsToEtb(etbToCents(body.amount))}:{}),phone:phoneHash(`+${phone}`)}));
const after=(ms:number)=>new Date(Date.now()+ms);
const localGuide='/video/cbe-bank-payment.mp4';
export function safeInlineCbeGuideUrl(raw=process.env.CHAPA_INLINE_CBE_GUIDE_URL){try{if(!raw||raw===localGuide)return localGuide;const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}
const capabilitiesFor=(transport:ChapaInlineTransport)=>measureChapa('capabilities',()=>(transport===chapaInlineTransport?inlineMethodCatalog:createInlineMethodCatalog(transport)).get());

export async function chapaInlineConfig(client:PrismaClient,userId:string){
 const health=chapaInlineAvailability();
 const [contact,methods,depositBonus]=await Promise.all([measureChapa('database',()=>client.telegramOwnContact.findUnique({where:{userId},select:{phoneCipher:true,botId:true,revokedAt:true}})),health.enabled?capabilitiesFor(chapaInlineTransport):Promise.resolve([]),measureChapa('pricing',()=>getDepositBonusPolicy(client))]);
 let phone:string|null=null;try{if(contact&&!contact.revokedAt)phone=decryptPhone(contact.phoneCipher,contact.botId)}catch{}
 return {apiVersion:'v2' as const,configured:health.configured,enabled:health.enabled,recoveryEnabled:health.recoveryEnabled,mode:health.mode,minTopup:CHAPA_TOPUP_MIN_ETB,maxTopup:CHAPA_TOPUP_MAX_ETB,methods,phone,depositBonus,cbeBankEnabled:health.enabled&&process.env.CHAPA_INLINE_CBE_BANK_ENABLED==='true',cbeGuideUrl:safeInlineCbeGuideUrl()};
}
/** A lost response may discover the existing owned attempt, never initialize it. */
export async function findInlineCheckoutByKey(client:PrismaClient,userId:string,key:string){
 const order=await client.chapaCheckout.findUnique({where:{userId_key:{userId,key:z.string().uuid().parse(key)}}});
 if(!order||!isV2InlineCheckout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 return ownChapaCheckout(order);
}
/** Quote, contact, ownership and financial guards finish before provider HTTP.
 * The complete immutable intent and its first dispatch lease commit together. */
export async function createInlineCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaInlineTransport=chapaInlineTransport){
 const body=input.parse(raw),phone=normalizePaymentPhone(body.phone),problem=paymentPhoneProblem(body.phone,body.paymentMethod);
 if(!phone||problem)throw new ChapaError(422,'INVALID_PHONE',paymentPhoneProblemMessage(problem??'invalid'));
 const hash=requestHash(body,phone),previous=await measureChapa('lookup',()=>client.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}}));
 const assertReplay=(order:ChapaCheckout)=>{if(!isV2InlineCheckout(order)||order.requestHash!==hash)throw new ChapaError(409,'KEY_REUSED','Keep the original payment details.')};
 if(previous){assertReplay(previous);return {order:await initializeInlineCheckout(client,previous,userId,reauthorize,transport)}}
 // Fresh top-ups obey Lowwin's minimum before capabilities/provider work.
 // Existing owned attempts above retain their original immutable amount.
 if(body.purpose==='TOP_UP'){
  const cents=etbToCents(body.amount);
  if(cents<CHAPA_TOPUP_MIN_CENTS||cents>CHAPA_TOPUP_MAX_CENTS)throw new ChapaError(422,'INVALID_AMOUNT','Top up between 5.00 and 43,200.00 ETB.');
 }
 const bonusReady=body.purpose==='TOP_UP'&&await depositBonusStorageReady(client);
 const health=requireChapaInline();
 if(body.flow==='HOSTED'?(body.paymentMethod!=='cbe-bank'||process.env.CHAPA_INLINE_CBE_BANK_ENABLED!=='true'):body.paymentMethod==='cbe-bank')throw new ChapaError(422,'METHOD_UNAVAILABLE','Choose an enabled payment method.');
 const capabilities=body.flow==='INLINE'?await capabilitiesFor(transport):[];
 const prepared=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  // Match every financial writer's barrier order once. Keep the maintenance
  // result until after replay detection so an existing attempt remains readable.
  const halted=await measureChapa('locks',async()=>{
   const halted=await auctionMaintenance(tx);
   if(body.purpose==='BID')await tx.$queryRaw`SELECT a.id FROM "Auction" a JOIN "BidBatchOrder" b ON b."auctionId"=a.id WHERE b.id=${body.batchId} AND b."userId"=${userId} FOR UPDATE OF a`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
   return halted;
  });
  if(reauthorize)await reauthorize(tx);const contact=await eligible(tx,userId);
  const replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});if(replay){assertReplay(replay);return {created:false,order:replay}}
  if(halted)throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  if(!await allowIdentityRequest(tx,'chapa-inline-create',userId,24,3600000))throw new ChapaError(429,'RATE_LIMITED','Check Transactions before trying another payment.');
  const batch=body.purpose==='BID'?await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}}):null;
  if(body.purpose==='BID'){
   if(!batch||batch.quoteHash!==body.quoteHash||batch.status!=='QUOTED')throw new ChapaError(409,'TERMS_CHANGED','Review your bid quote again.');
   if(await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','Check the existing payment for this selection.');
   const priced=await measureChapa('pricing',()=>validateBatchInTransaction(tx,userId,batch.auctionSlug,batchLines(batch).map(line=>line.number),batch.feeVersion,batch.couponId??undefined,true));
   if(priced.totalCents!==batch.totalCents||JSON.stringify(priced.lines)!==JSON.stringify(batchLines(batch)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review before paying.');
  }
  const amountCents=batch?.totalCents??etbToCents(body.purpose==='TOP_UP'?body.amount:'0'),method=capabilities.find(method=>method.slug===body.paymentMethod);
  if(amountCents<(body.purpose==='TOP_UP'?CHAPA_TOPUP_MIN_CENTS:100n)||amountCents>CHAPA_TOPUP_MAX_CENTS)throw new ChapaError(422,'INVALID_AMOUNT',body.purpose==='TOP_UP'?'Top up between 5.00 and 43,200.00 ETB.':'Pay between 1.00 and 43,200.00 ETB.');
  if(body.flow==='INLINE'&&(!method||amountCents<BigInt(method.minimumCents)||amountCents>BigInt(method.maximumCents)))throw new ChapaError(422,'METHOD_UNAVAILABLE','This method does not support the quoted amount.');
  const current=requireChapaInline();if(current.mode!==health.mode||current.credentialFingerprint!==health.credentialFingerprint||current.publicKeyFingerprint!==health.publicKeyFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Reload payment options before paying.');
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`,idempotencyKey=`lowwin-inline:${id}`,returnUrl=new URL(`/payments/chapa/return?checkout=${id}`,process.env.MINI_APP_URL).href;
  const depositBonus=body.purpose==='TOP_UP'?await quoteDepositBonusInTransaction(tx,amountCents,bonusReady):null;
  if(body.purpose==='TOP_UP'&&(depositBonus&&(body.approvedDepositBonusVersion!==depositBonus.policyVersion||body.approvedDepositBonusAmount===undefined)||body.approvedDepositBonusAmount!==undefined&&etbToCents(body.approvedDepositBonusAmount)!==BigInt(depositBonus?.amountCents??'0')))throw new ChapaError(409,'DEPOSIT_BONUS_CHANGED','The deposit bonus changed. Review the updated offer before paying.');
  const initialization={apiVersion:'v2',flowVersion:4,flow:body.flow,amountCents:String(amountCents),merchantReference,idempotencyKey,publicKeyFingerprint:health.publicKeyFingerprint!,paymentMethod:body.paymentMethod,payerPhoneHash:phoneHash(`+${phone}`),returnUrl,returnUrlVersion:1,...(depositBonus?{depositBonus}:{}),...(batch?{batch:ownBatch(batch)}:{})};
  if(!await allowIdentityRequest(tx,'chapa-inline-initialize',id,5,86400000))throw new ChapaError(429,'RATE_LIMITED','Check the original payment before trying again.');
  const order=await tx.chapaCheckout.create({data:{id,userId,key:body.key,requestHash:hash,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,initialization:JSON.parse(JSON.stringify(initialization)),chargeType:body.flow,flowVersion:4,batchId:batch?.id,payerPhoneCipher:encryptPhone(phone,contact.botId),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents,currency:'ETB',paymentMethod:body.paymentMethod,auctionId:batch?.auctionId,auctionSlug:batch?.auctionSlug,bidNumber:batch?new Prisma.Decimal(batchLines(batch)[0].number):null,feeVersion:batch?.feeVersion,grossFee:batch?new Prisma.Decimal(centsToEtb(batch.grossCents)):null,discountPoints:batch?new Prisma.Decimal(centsToEtb(batch.discountCents)):new Prisma.Decimal(0),couponId:batch?.couponId,status:'SUBMITTING',reason:'AWAITING_PROVIDER',attempts:1,leaseUntil:after(45000),expiresAt:after(body.flow==='INLINE'?300000:86400000),nextCheckAt:after(15000),reconcileUntil:after(30*86400000)}});
  return {created:true,order};
 },PAYMENT_TRANSACTION_OPTIONS));
 return {order:prepared.created?await dispatchInlineCheckout(client,prepared.order,userId,transport,'create'):await initializeInlineCheckout(client,prepared.order,userId,reauthorize,transport)};
}

/** Replays only the original immutable operation under a new dispatch lease.
 * Expired replay windows and incompatible rotated keys only reconcile privately. */
export async function initializeInlineCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,reauthorize?:Authorize,transport:ChapaInlineTransport=chapaInlineTransport){
 if(order.userId!==userId||!isV2InlineCheckout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 const health=chapaInlineAvailability();
 if(order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Check this original payment with its original configuration.');
 if(order.creditJournalId||order.authorizationReference||order.checkoutUrl)return ownChapaCheckout(order);
 if(!['SUBMITTING','PENDING'].includes(order.status)||order.providerStatus||order.verificationState==='MISMATCH'||classifyChapaApiError(order.initializationHttpStatus,order.initializationErrorCode)==='request')return getChapaCheckout(client,userId,order.id);
 if(!inlineTransportBinding(order)||Date.now()-order.createdAt.getTime()>86400000)return verifyChapaCheckout(client,order.id,userId,reauthorize,transport,true);
 requireChapaInline('recover');
 const acquired=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  if(reauthorize)await reauthorize(tx);if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payment requests are paused.');
  if(!await allowIdentityRequest(tx,'chapa-inline-initialize',order.id,5,86400000))return {count:0};
  return tx.chapaCheckout.updateMany({where:{id:order.id,userId,creditJournalId:null,authorizationReference:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:after(45000),nextCheckAt:after(15000),attempts:{increment:1}}});
 },PAYMENT_TRANSACTION_OPTIONS));
 return acquired.count?dispatchInlineCheckout(client,order,userId,transport,'recover'):getChapaCheckout(client,userId,order.id);
}
async function dispatchInlineCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,transport:ChapaInlineTransport,operation:'create'|'recover'){
 if(!inlineTransportBinding(order))return verifyChapaCheckout(client,order.id,userId,undefined,transport,true);
 const writable={id:order.id,userId,creditJournalId:null,authorizationReference:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']}} satisfies Prisma.ChapaCheckoutWhereInput;
 try{
  const initialization=order.initialization as Record<string,unknown>;
  markChapaDispatch();
  if(order.chargeType==='HOSTED'){
   const request:ChapaCreate={amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),returnUrl:String(initialization.returnUrl),returnUrlVersion:1};
   const created=createdChapaSession(await measureChapa('initialize',()=>transport.create(request)));
   if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check the original payment.');
   const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{checkoutUrl:created.checkoutUrl,providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{}),leaseUntil:null,status:'PENDING',reason:'AWAITING_PROVIDER',verificationState:'UNVERIFIED',initializationErrorCode:null,initializationHttpStatus:null,nextCheckAt:new Date()}}));
   if(rows[0])return ownChapaCheckout(rows[0]);
  }else{
   const request={amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),paymentMethod:order.paymentMethod!,phone:decryptPhone(order.payerPhoneCipher!,order.phoneBotId!)};
   const created=createdChapaDirect(await measureChapa('initialize',()=>transport.inline(request,operation)));
   if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check the original payment.');
   const authorization={authorizationReference:created.reference,providerRequestId:created.requestId,authType:created.authType,providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{})};
   const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{...authorization,status:'AUTH_NEEDED',reason:null,verificationState:'UNVERIFIED',leaseUntil:null,nextCheckAt:new Date(),initializationErrorCode:null,initializationHttpStatus:null}}));
   if(rows[0])return ownChapaCheckout(rows[0]);
   const pending=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:{id:order.id,userId,creditJournalId:null,authorizationReference:null,status:{in:['PENDING','AUTH_NEEDED','VERIFYING']},verificationState:'VERIFIED',providerStatus:{in:['PENDING','AUTH_NEEDED']}},data:authorization}));
   if(pending[0])return ownChapaCheckout(pending[0]);
  }
 }catch(error){
  const rejected=error instanceof ChapaProviderError&&error.category==='request';
  const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{leaseUntil:null,status:rejected?'NEEDS_REVIEW':'PENDING',reason:rejected?'INITIALIZATION_REJECTED':'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',nextCheckAt:after(rejected?300000:15000),initializationErrorCode:error instanceof ChapaProviderError?error.paymentReason??error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null}}));
  if(rows[0])return ownChapaCheckout(rows[0]);
 }
 return getChapaCheckout(client,userId,order.id);
}
export async function reconcileInlineCheckouts(client:PrismaClient,limit=10,transport:ChapaInlineTransport=chapaInlineTransport){
 const health=chapaAvailability();if(!health.recoveryEnabled)return {checked:0};
 const rows=await client.chapaCheckout.findMany({where:{flowVersion:4,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,creditJournalId:null,reconcileUntil:{gt:new Date()},nextCheckAt:{lte:new Date()},attempts:{lt:500},status:{in:['SUBMITTING','PENDING','AUTH_NEEDED','VERIFYING','NEEDS_REVIEW']}},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});
 let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id,undefined,undefined,transport);checked++}catch{}}
 return {checked};
}
