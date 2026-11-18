import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type ChapaCheckout} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {CHAPA_TOPUP_MIN_CENTS,CHAPA_TOPUP_MIN_ETB,CHAPA_TOPUP_MAX_CENTS,CHAPA_TOPUP_MAX_ETB} from '@/lib/chapa-topup-policy';
import {allowIdentityRequest,allowIdentityRequests} from '@/lib/rate-limit';
import {normalizePaymentPhone,paymentPhoneProblem,paymentPhoneProblemMessage} from '@/lib/payment-phone';
import {classifyChapaApiError} from '@/lib/chapa-api-error';
import {decryptPhone,encryptPhone,phoneHash} from '../auth/own-contact';
import {batchLines,ownBatch,validateBatchInTransaction} from '../auctions/batch';
import {auctionMaintenance} from '../auctions/maintenance';
import {eligible,getChapaCheckout,ownChapaCheckout,verifyChapaCheckout} from './chapa';
import {ChapaError,ChapaProviderError,chapaAvailability,chapaHash,chapaWebhookSignatureProfile,chapaTransport,createdChapaDirect,createdCurrentChapaDirect,createdChapaSession,type ChapaCreate,type ChapaTransport} from './chapa-provider';
import {chapaInlineAvailability,chapaInlineTransport,createInlineMethodCatalog,inlineMethodCatalog,inlineTransportBinding,isV2InlineCheckout,requireChapaInline,type ChapaInlineTransport} from './chapa-inline-provider';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {markChapaDispatch,markChapaTransactionStarted,measureChapa} from './chapa-timing';
import {publishChapaCommitted} from './chapa-committed';
import {depositBonusStorageReady,getDepositBonusPolicy,quoteDepositBonusInTransaction} from '../wallet/deposit-bonus';
import {currentDirectAvailability,currentDirectBinding,currentDirectEngineTransport,currentDirectTransport,currentDirectMethods,requireCurrentDirect} from './chapa-current-direct-provider';
import {isCurrentDirectCheckout,isCurrentV2Checkout} from './chapa-current-protocol';
import type {PaymentSessionAuthorizer as Authorize} from './session';

const common={key:z.string().uuid(),flow:z.enum(['INLINE','HOSTED','DIRECT']),paymentMethod:z.enum(['telebirr','cbebirr','mpesa','ebirr','cbe-bank']),phone:z.string().min(9).max(40)};
const input=z.discriminatedUnion('purpose',[z.object({...common,purpose:z.literal('BID'),batchId:z.string().uuid(),quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({...common,purpose:z.literal('TOP_UP'),amount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/),approvedDepositBonusVersion:z.number().int().nonnegative().optional(),approvedDepositBonusAmount:z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/).optional()}).strict()]);
type InlineInput=z.infer<typeof input>;
const requestHash=(body:InlineInput,phone:string)=>chapaHash(JSON.stringify({...body,...(body.purpose==='TOP_UP'?{amount:centsToEtb(etbToCents(body.amount))}:{}),phone:phoneHash(`+${phone}`)}));
const after=(ms:number)=>new Date(Date.now()+ms);
const localGuide='/video/cbe-bank-payment.mp4';
export function safeInlineCbeGuideUrl(raw=process.env.CHAPA_INLINE_CBE_GUIDE_URL){try{if(!raw||raw===localGuide)return localGuide;const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}}
const capabilitiesFor=(transport:ChapaInlineTransport,protocol:'INLINE'|'DIRECT'='INLINE')=>measureChapa('capabilities',()=>(protocol==='DIRECT'?currentDirectMethods(transport===currentDirectTransport?chapaTransport:transport):transport===chapaInlineTransport?inlineMethodCatalog:createInlineMethodCatalog(transport)).get());
const currentBinding=(order:ChapaCheckout)=>isCurrentDirectCheckout(order)?currentDirectBinding(order):inlineTransportBinding(order);

async function lockCurrentTopUpPreparation(tx:Prisma.TransactionClient,userId:string){
 // This statement must finish before the maintenance read starts: a SELECT
 // snapshot taken before waiting for an exclusive maintenance writer is stale.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
 const [state]=await tx.$queryRaw<{halted:boolean}[]>`
  WITH maintenance AS MATERIALIZED (
   SELECT COALESCE((SELECT action='AUCTIONS_MAINTENANCE_HALTED' FROM "AdminAudit"
    WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1),false) AS halted
  ), locked AS MATERIALIZED (
   SELECT halted,pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0)) FROM maintenance
  ) SELECT halted FROM locked`;
 if(!state)throw new Error('Payment maintenance state is unavailable');
 return state.halted;
}

export async function chapaInlineConfig(client:PrismaClient,userId:string){
 const health=chapaInlineAvailability();
 const [contact,methods,depositBonus]=await Promise.all([measureChapa('database',()=>client.telegramOwnContact.findUnique({where:{userId},select:{phoneCipher:true,botId:true,revokedAt:true}})),health.enabled?capabilitiesFor(chapaInlineTransport):Promise.resolve([]),measureChapa('pricing',()=>getDepositBonusPolicy(client))]);
 let phone:string|null=null;try{if(contact&&!contact.revokedAt)phone=decryptPhone(contact.phoneCipher,contact.botId)}catch{}
 return {apiVersion:'v2' as const,configured:health.configured,enabled:health.enabled,recoveryEnabled:health.recoveryEnabled,mode:health.mode,minTopup:CHAPA_TOPUP_MIN_ETB,maxTopup:CHAPA_TOPUP_MAX_ETB,methods,phone,depositBonus,cbeBankEnabled:false,cbeGuideUrl:safeInlineCbeGuideUrl()};
}
export async function chapaCurrentDirectConfig(client:PrismaClient,userId:string){
 const health=currentDirectAvailability();
 const [contact,methods,depositBonus]=await Promise.all([measureChapa('database',()=>client.telegramOwnContact.findUnique({where:{userId},select:{phoneCipher:true,botId:true,revokedAt:true}})),health.enabled?capabilitiesFor(currentDirectTransport,'DIRECT'):Promise.resolve([]),measureChapa('pricing',()=>getDepositBonusPolicy(client))]);
 let phone:string|null=null;try{if(contact&&!contact.revokedAt)phone=decryptPhone(contact.phoneCipher,contact.botId)}catch{}
 return {apiVersion:'v2' as const,flow:'DIRECT' as const,flowVersion:5,configured:health.configured,enabled:health.enabled,recoveryEnabled:health.recoveryEnabled,mode:health.mode,minTopup:CHAPA_TOPUP_MIN_ETB,maxTopup:CHAPA_TOPUP_MAX_ETB,methods:methods.filter(m=>['telebirr','cbebirr','mpesa'].includes(m.slug)),phone,depositBonus,cbeBankEnabled:false,cbeGuideUrl:safeInlineCbeGuideUrl()};
}
export async function findCurrentDirectCheckoutByKey(client:PrismaClient,userId:string,key:string){
 const order=await client.chapaCheckout.findUnique({where:{userId_key:{userId,key:z.string().uuid().parse(key)}}});
 if(!order||!isCurrentDirectCheckout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');return ownChapaCheckout(order);
}
export function createCurrentDirectCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 return createInlineCheckout(client,userId,raw,reauthorize,transport===chapaTransport?currentDirectTransport:currentDirectEngineTransport(transport),'DIRECT');
}

/** This owned lookup can run alongside the mutation limit after authentication.
 * The route awaits the limit before invoking the request-bound continuation. */
export async function prepareCurrentDirectCreation(client:PrismaClient,userId:string,raw:unknown,transport:ChapaTransport=chapaTransport){
 const intent=parsePaymentIntent(raw);
 const previous=await lookupOriginal(client,userId,intent.body.key);
 return (reauthorize?:Authorize)=>createParsedCheckout(client,userId,intent,reauthorize,transport===chapaTransport?currentDirectTransport:currentDirectEngineTransport(transport),'DIRECT',previous);
}
/** A lost response may discover the existing owned attempt, never initialize it. */
export async function findInlineCheckoutByKey(client:PrismaClient,userId:string,key:string){
 const order=await client.chapaCheckout.findUnique({where:{userId_key:{userId,key:z.string().uuid().parse(key)}}});
 if(!order||!isV2InlineCheckout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 return ownChapaCheckout(order);
}
function parsePaymentIntent(raw:unknown){
 const body=input.parse(raw),phone=normalizePaymentPhone(body.phone),problem=paymentPhoneProblem(body.phone,body.paymentMethod);
 if(!phone||problem)throw new ChapaError(422,'INVALID_PHONE',paymentPhoneProblemMessage(problem??'invalid'));
 return {body,phone};
}
function lookupOriginal(client:PrismaClient,userId:string,key:string){
 return measureChapa('lookup',()=>client.chapaCheckout.findUnique({where:{userId_key:{userId,key}}}));
}
export async function createInlineCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaInlineTransport=chapaInlineTransport,protocol:'INLINE'|'DIRECT'='INLINE'){
 return createParsedCheckout(client,userId,parsePaymentIntent(raw),reauthorize,transport,protocol);
}
/** Quote, contact, ownership and financial guards finish before provider HTTP.
 * The complete immutable intent and its first dispatch lease commit together. */
async function createParsedCheckout(client:PrismaClient,userId:string,{body,phone}:ReturnType<typeof parsePaymentIntent>,reauthorize:Authorize|undefined,transport:ChapaInlineTransport,protocol:'INLINE'|'DIRECT',original?:ChapaCheckout|null){
 const hash=requestHash(body,phone),previousLookup=original===undefined?lookupOriginal(client,userId,body.key):Promise.resolve(original);
 // A safe new Direct top-up can overlap its read-only schema probe with owned
 // key discovery. Capture rejection immediately: an existing original must
 // recover even when rollout readiness is unavailable or creation is paused.
 const probeBonus=protocol==='DIRECT'&&body.purpose==='TOP_UP'&&body.flow==='DIRECT'&&['telebirr','cbebirr','mpesa'].includes(body.paymentMethod)&&currentDirectAvailability().enabled&&etbToCents(body.amount)>=CHAPA_TOPUP_MIN_CENTS&&etbToCents(body.amount)<=CHAPA_TOPUP_MAX_CENTS;
 const bonusProbe=probeBonus?measureChapa('schema',()=>depositBonusStorageReady(client)).then(ready=>({ok:true as const,ready}),error=>({ok:false as const,error})):null;
 const previous=await previousLookup;
 const assertReplay=(order:ChapaCheckout)=>{if(!(protocol==='DIRECT'?isCurrentDirectCheckout(order):isV2InlineCheckout(order))||order.requestHash!==hash)throw new ChapaError(409,'KEY_REUSED','Keep the original payment details.')};
 if(previous){assertReplay(previous);return {order:await initializeInlineCheckout(client,previous,userId,reauthorize,transport)}}
 if(protocol==='INLINE'&&transport===chapaInlineTransport)throw new ChapaError(410,'PAYMENT_VERSION_RETIRED','Reload payment options to use the current secure checkout. Existing payments remain available in Transactions.');
 // Fresh top-ups obey Lowwin's minimum before capabilities/provider work.
 // Existing owned attempts above retain their original immutable amount.
 if(body.purpose==='TOP_UP'){
  const cents=etbToCents(body.amount);
  if(cents<CHAPA_TOPUP_MIN_CENTS||cents>CHAPA_TOPUP_MAX_CENTS)throw new ChapaError(422,'INVALID_AMOUNT','Top up between 5.00 and 43,200.00 ETB.');
 }
 const health=protocol==='DIRECT'?requireCurrentDirect():requireChapaInline();
 // Retain the input variants above for immutable original-attempt recovery,
 // but never create another hosted/retired-method payment from this checkout.
 if(body.flow!==protocol||!['telebirr','cbebirr','mpesa'].includes(body.paymentMethod))throw new ChapaError(422,'METHOD_UNAVAILABLE','Choose an enabled payment method.');
 // Schema readiness and capabilities do not depend on one another. Keep both
 // outside financial locks and overlap their cold reads before preparation.
 const [bonusReady,capabilities]=await Promise.all([
  body.purpose==='TOP_UP'?bonusProbe?bonusProbe.then(result=>{if(!result.ok)throw result.error;return result.ready}):measureChapa('schema',()=>depositBonusStorageReady(client)):Promise.resolve(false),
  capabilitiesFor(transport,protocol),
 ]);
 const selectedMethod=capabilities.find(method=>method.slug===body.paymentMethod);
 if(!selectedMethod)throw new ChapaError(422,'METHOD_UNAVAILABLE','Choose an enabled payment method.');
 if(body.purpose==='TOP_UP'){
  const amount=etbToCents(body.amount);
  if(amount<BigInt(selectedMethod.minimumCents)||amount>BigInt(selectedMethod.maximumCents))throw new ChapaError(422,'METHOD_UNAVAILABLE','This method does not support the quoted amount.');
 }
 const transactionQueuedAt=performance.now();
 const prepared=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  markChapaTransactionStarted(transactionQueuedAt);
  // Match every financial writer's barrier order once. Keep the maintenance
  // result until after replay detection so an existing attempt remains readable.
  const halted=await measureChapa('locks',async()=>{
   if(protocol==='DIRECT'&&body.purpose==='TOP_UP')return lockCurrentTopUpPreparation(tx,userId);
   const halted=await auctionMaintenance(tx);
   if(body.purpose==='BID')await tx.$queryRaw`SELECT a.id FROM "Auction" a JOIN "BidBatchOrder" b ON b."auctionId"=a.id WHERE b.id=${body.batchId} AND b."userId"=${userId} FOR UPDATE OF a`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
   return halted;
  });
  const checkCreation=protocol==='DIRECT'?reauthorize?.forCurrentDirectCreate:undefined;
  const fresh=checkCreation?await measureChapa('reauthorize',()=>checkCreation(tx,userId,body.key)):null;
  if(!fresh&&reauthorize)await measureChapa('reauthorize',()=>reauthorize(tx));
  const contact=fresh??await measureChapa('eligibility',()=>eligible(tx,userId));
  if(fresh?.replayExists!==false){
   const replay=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
   if(replay){assertReplay(replay);return {created:false,order:replay}}
  }
  if(halted)throw new ChapaError(503,'AUCTIONS_PAUSED','New payments are paused. Existing payments can still be checked.');
  if(protocol!=='DIRECT'&&!await allowIdentityRequest(tx,'chapa-inline-create',userId,24,3600000))throw new ChapaError(429,'RATE_LIMITED','Check Transactions before trying another payment.');
  const batch=body.purpose==='BID'?await tx.bidBatchOrder.findFirst({where:{id:body.batchId,userId}}):null;
  if(body.purpose==='BID'){
   if(!batch||batch.quoteHash!==body.quoteHash||batch.status!=='QUOTED')throw new ChapaError(409,'TERMS_CHANGED','Review your bid quote again.');
   if(await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','Check the existing payment for this selection.');
   const priced=await measureChapa('pricing',()=>validateBatchInTransaction(tx,userId,batch.auctionSlug,batchLines(batch).map(line=>line.number),batch.feeVersion,batch.couponId??undefined,true));
   if(priced.totalCents!==batch.totalCents||JSON.stringify(priced.lines)!==JSON.stringify(batchLines(batch)))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review before paying.');
  }
  const amountCents=batch?.totalCents??etbToCents(body.purpose==='TOP_UP'?body.amount:'0'),method=selectedMethod;
  if(amountCents<(body.purpose==='TOP_UP'?CHAPA_TOPUP_MIN_CENTS:100n)||amountCents>CHAPA_TOPUP_MAX_CENTS)throw new ChapaError(422,'INVALID_AMOUNT',body.purpose==='TOP_UP'?'Top up between 5.00 and 43,200.00 ETB.':'Pay between 1.00 and 43,200.00 ETB.');
  if(!method||amountCents<BigInt(method.minimumCents)||amountCents>BigInt(method.maximumCents))throw new ChapaError(422,'METHOD_UNAVAILABLE','This method does not support the quoted amount.');
  const current=protocol==='DIRECT'?requireCurrentDirect():requireChapaInline();if(current.mode!==health.mode||current.credentialFingerprint!==health.credentialFingerprint||current.publicKeyFingerprint!==health.publicKeyFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Reload payment options before paying.');
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`,idempotencyKey=`lowwin-${protocol==='DIRECT'?'direct-v5':'inline'}:${id}`,returnUrl=new URL(`/payments/chapa/return?checkout=${id}`,process.env.MINI_APP_URL).href;
  const depositBonus=body.purpose==='TOP_UP'?await quoteDepositBonusInTransaction(tx,amountCents,bonusReady):null;
  if(body.purpose==='TOP_UP'&&(depositBonus&&(body.approvedDepositBonusVersion!==depositBonus.policyVersion||body.approvedDepositBonusAmount===undefined)||body.approvedDepositBonusAmount!==undefined&&etbToCents(body.approvedDepositBonusAmount)!==BigInt(depositBonus?.amountCents??'0')))throw new ChapaError(409,'DEPOSIT_BONUS_CHANGED','The deposit bonus changed. Review the updated offer before paying.');
  const flowVersion=protocol==='DIRECT'?5:4;
  const initialization={apiVersion:'v2',flowVersion,flow:body.flow,amountCents:String(amountCents),merchantReference,idempotencyKey,...(protocol==='DIRECT'?{metadata:{checkout_id:id}}:{publicKeyFingerprint:health.publicKeyFingerprint!}),webhookSignatureProfile:chapaWebhookSignatureProfile()!,paymentMethod:body.paymentMethod,payerPhoneHash:phoneHash(`+${phone}`),returnUrl,returnUrlVersion:1,...(depositBonus?{depositBonus}:{}),...(batch?{batch:ownBatch(batch)}:{})};
  if(protocol==='DIRECT'){
   if(!await allowIdentityRequests(tx,[{scope:'chapa-inline-create',identity:userId,maximum:24,windowMs:3600000},{scope:'chapa-inline-initialize',identity:id,maximum:5,windowMs:86400000}]))throw new ChapaError(429,'RATE_LIMITED','Check Transactions before trying another payment.');
  }else if(!await allowIdentityRequest(tx,'chapa-inline-initialize',id,5,86400000))throw new ChapaError(429,'RATE_LIMITED','Check the original payment before trying again.');
  const order=await measureChapa('intent',()=>tx.chapaCheckout.create({data:{id,userId,key:body.key,requestHash:hash,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,initialization:JSON.parse(JSON.stringify(initialization)),chargeType:body.flow,flowVersion,batchId:batch?.id,payerPhoneCipher:encryptPhone(phone,contact.botId),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents,currency:'ETB',paymentMethod:body.paymentMethod,auctionId:batch?.auctionId,auctionSlug:batch?.auctionSlug,bidNumber:batch?new Prisma.Decimal(batchLines(batch)[0].number):null,feeVersion:batch?.feeVersion,grossFee:batch?new Prisma.Decimal(centsToEtb(batch.grossCents)):null,discountPoints:batch?new Prisma.Decimal(centsToEtb(batch.discountCents)):new Prisma.Decimal(0),couponId:batch?.couponId,status:'SUBMITTING',reason:'AWAITING_PROVIDER',attempts:1,leaseUntil:after(45000),expiresAt:after(body.flow==='HOSTED'?86400000:300000),nextCheckAt:after(15000),reconcileUntil:after(30*86400000)}}));
  return {created:true,order};
 },PAYMENT_TRANSACTION_OPTIONS));
 return {order:prepared.created?await dispatchInlineCheckout(client,prepared.order,userId,transport,'create'):await initializeInlineCheckout(client,prepared.order,userId,reauthorize,transport)};
}

/** Replays only the original immutable operation under a new dispatch lease.
 * Expired replay windows and incompatible rotated keys only reconcile privately. */
export async function initializeInlineCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,reauthorize?:Authorize,transport:ChapaInlineTransport=chapaInlineTransport){
 if(order.userId!==userId||!isCurrentV2Checkout(order))throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 const direct=isCurrentDirectCheckout(order),health=direct?currentDirectAvailability():chapaInlineAvailability();
 if(direct&&transport===chapaInlineTransport)transport=currentDirectTransport;
 if(order.mode!==health.mode||order.credentialFingerprint!==health.credentialFingerprint)throw new ChapaError(503,'CONFIGURATION_CHANGED','Check this original payment with its original configuration.');
 if(order.creditJournalId||order.authorizationReference||order.checkoutUrl)return ownChapaCheckout(order);
 if(!['SUBMITTING','PENDING'].includes(order.status)||order.providerStatus||order.verificationState==='MISMATCH'||classifyChapaApiError(order.initializationHttpStatus,order.initializationErrorCode)==='request')return getChapaCheckout(client,userId,order.id);
 if(!currentBinding(order)||Date.now()-order.createdAt.getTime()>86400000)return verifyChapaCheckout(client,order.id,userId,reauthorize,transport,true);
 if(direct)requireCurrentDirect('recover');else requireChapaInline('recover');
 // A duplicate request can observe the immutable intent before its original
 // provider HTTP has returned. It needs neither financial locks nor another
 // initialization-rate token while that dispatch already owns its lease.
 if(order.leaseUntil&&order.leaseUntil.getTime()>Date.now())return ownChapaCheckout(order);
 const dispatchLease=after(45000);
 const acquired=await measureChapa('prepare',()=>client.$transaction(async tx=>{
  if(reauthorize)await reauthorize(tx);if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','New payment requests are paused.');
  const claim=await tx.chapaCheckout.updateMany({where:{id:order.id,userId,creditJournalId:null,authorizationReference:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:dispatchLease,nextCheckAt:after(15000),attempts:{increment:1}}});
  if(!claim.count)return claim;
  // Only a won dispatch claim consumes the bounded provider retry budget.
  // Throwing rolls the claim back atomically when the budget is exhausted.
  if(!await allowIdentityRequest(tx,'chapa-inline-initialize',order.id,5,86400000))throw new ChapaError(429,'RATE_LIMITED','Check the original payment before trying again.');
  return claim;
 },PAYMENT_TRANSACTION_OPTIONS));
 return acquired.count?dispatchInlineCheckout(client,{...order,leaseUntil:dispatchLease},userId,transport,'recover'):getChapaCheckout(client,userId,order.id);
}
async function dispatchInlineCheckout(client:PrismaClient,order:ChapaCheckout,userId:string,transport:ChapaInlineTransport,operation:'create'|'recover'){
 if(!currentBinding(order))return verifyChapaCheckout(client,order.id,userId,undefined,transport,true);
 // Delayed initialization replies must not release a successor dispatch or
 // verification lease, or replace its authoritative evidence with transport state.
 if(!order.leaseUntil)return getChapaCheckout(client,userId,order.id);
 const writable={id:order.id,userId,leaseUntil:order.leaseUntil,creditJournalId:null,authorizationReference:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']}} satisfies Prisma.ChapaCheckoutWhereInput;
 try{
  const initialization=order.initialization as Record<string,unknown>;
  if(order.chargeType==='HOSTED'){
   const request:ChapaCreate={amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),returnUrl:String(initialization.returnUrl),returnUrlVersion:1};
   markChapaDispatch();
   const created=createdChapaSession(await measureChapa('initialize',()=>transport.create(request)));
   if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check the original payment.');
   const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{checkoutUrl:created.checkoutUrl,providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{}),leaseUntil:null,status:'PENDING',reason:'AWAITING_PROVIDER',verificationState:'UNVERIFIED',initializationErrorCode:null,initializationHttpStatus:null,nextCheckAt:new Date()}}));
   if(rows[0]){void publishChapaCommitted(order.id);return ownChapaCheckout(rows[0])}
  }else{
   const request={amountCents:String(order.amountCents),merchantReference:order.merchantReference,idempotencyKey:String(initialization.idempotencyKey),paymentMethod:order.paymentMethod!,phone:decryptPhone(order.payerPhoneCipher!,order.phoneBotId!),...(isCurrentDirectCheckout(order)?{metadata:initialization.metadata as Record<string,string>}:{})};
   markChapaDispatch();
   const response=await measureChapa('initialize',()=>transport.inline(request,operation));
   const created=isCurrentDirectCheckout(order)?createdCurrentChapaDirect(response,order.paymentMethod!):createdChapaDirect(response);
   if(!created)throw new ChapaError(502,'PROVIDER_UNAVAILABLE','Payment confirmation is pending. Check the original payment.');
   const authorization={authorizationReference:created.reference,providerRequestId:created.requestId,authType:created.authType,providerCreatedAt:created.createdAt??null,...(created.expiresAt?{expiresAt:created.expiresAt}:{})};
   const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{...authorization,status:'AUTH_NEEDED',reason:null,verificationState:'UNVERIFIED',leaseUntil:null,nextCheckAt:new Date(),initializationErrorCode:null,initializationHttpStatus:null}}));
   if(rows[0]){void publishChapaCommitted(order.id);return ownChapaCheckout(rows[0])}
   const pending=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:{id:order.id,userId,creditJournalId:null,authorizationReference:null,status:{in:['PENDING','AUTH_NEEDED','VERIFYING']},verificationState:'VERIFIED',providerStatus:{in:['PENDING','AUTH_NEEDED']}},data:authorization}));
   if(pending[0]){void publishChapaCommitted(order.id);return ownChapaCheckout(pending[0])}
  }
 }catch(error){
  const rejected=error instanceof ChapaProviderError&&error.category==='request';
  const rows=await measureChapa('persist',()=>client.chapaCheckout.updateManyAndReturn({where:writable,data:{leaseUntil:null,status:rejected?'NEEDS_REVIEW':'PENDING',reason:rejected?'INITIALIZATION_REJECTED':'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE',nextCheckAt:after(rejected?300000:15000),initializationErrorCode:error instanceof ChapaProviderError?error.paymentReason??error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null}}));
  if(rows[0]){void publishChapaCommitted(order.id);return ownChapaCheckout(rows[0])}
 }
 return getChapaCheckout(client,userId,order.id);
}
export async function reconcileInlineCheckouts(client:PrismaClient,limit=10,transport:ChapaInlineTransport=chapaInlineTransport){
 const health=chapaAvailability();if(!health.recoveryEnabled)return {checked:0};
 const rows=await client.chapaCheckout.findMany({where:{flowVersion:4,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,creditJournalId:null,reconcileUntil:{gt:new Date()},nextCheckAt:{lte:new Date()},attempts:{lt:500},OR:[{status:{in:['SUBMITTING','PENDING','AUTH_NEEDED','VERIFYING','NEEDS_REVIEW']}},{verificationSignalVersion:{gt:client.chapaCheckout.fields.verificationHandledSignalVersion}}]},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit)),select:{id:true}});
 let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id,undefined,undefined,transport);checked++}catch{}}
 return {checked};
}
