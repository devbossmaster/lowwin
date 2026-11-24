import {materializeAlert} from '../notifications/service';
import {walletBidsEnabled} from '../wallet/policy';
import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import {CHAPA_TOPUP_MIN_ETB,CHAPA_TOPUP_MAX_ETB} from '@/lib/chapa-topup-policy';
import {publicChapaAuthorizationReason,publicChapaCancelledBy,publicChapaPaymentReason,safeChapaPaymentReason} from '@/lib/chapa-payment-reason';
import {classifyChapaApiError} from '@/lib/chapa-api-error';
import {allowIdentityRequest} from '@/lib/rate-limit';
import {assertPlayerContact,contactBotId,decryptPhone,normalizePhone} from '../auth/own-contact';
import {fulfillBatchInTransaction} from '../auctions/batch';
import {BidError,submitBidInTransaction,type BidReceipt} from '../auctions/bids';
import {auctionMaintenance,lockAuctionMaintenance} from '../auctions/maintenance';
import {isSubmissionFeeOnly} from '../auctions/rules';
import {lockReferralDiscountInTransaction} from '../referrals/service';
import {ensureWallet,pointsSchema,seedPlatformAccounts} from '../wallet/ledger';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {measureChapa} from './chapa-timing';
import {matchesChapaMetadata} from './chapa-metadata';
import {ChapaError,ChapaProviderError,chapaAvailability,chapaConfigurationFingerprint,chapaHash,chapaTransport,createdChapaSession,isChapaHostedSessionReference,parseChapaEvidence,requireChapa,type ChapaCreate,type ChapaTransport} from './chapa-provider';
import {approvedRecoveryBinding,chapaRecoveryBindings} from './chapa-recovery-binding';
import {chapaMethodCatalog} from './chapa-methods';
import {chapaInlineAvailability,chapaInlineTransport,inlineTransportBinding,isV2InlineCheckout} from './chapa-inline-provider';
import {currentDirectAvailability} from './chapa-current-direct-provider';
import {isCurrentDirectCheckout,isCurrentV2Checkout} from './chapa-current-protocol';
import {chapaAuthorizationErrorFeedback,chapaAuthorizationFeedback,chapaAuthorizationFeedbackReason,type ChapaAuthorizationFeedback} from './chapa-authorization-feedback';
import {creditDepositBonusInTransaction,depositBonusQuote,ownDepositBonus} from '../wallet/deposit-bonus';
import {canSkipChapaPrivateVerification,chapaCompletionStatus,CHAPA_MIN_VERIFICATION_LEASE_REMAINING_MS,CHAPA_VERIFICATION_LEASE_MS,chapaPendingVerificationDelay,shouldRefreshChapaAuthorization,type ChapaCompletionStatus} from './chapa-verification-policy';
import {publishChapaCommitted} from './chapa-committed';
import {resolvedChapaWebhookReason} from './chapa-webhook-reason';
import {approvedLegacyRecoveryBinding,chapaLegacyRecoveryAvailability,isLegacyChapaCheckout,legacyChapaRecoveryAvailable,legacyChapaRecoveryBindings,legacyChapaRecoveryTransport,parseLegacyChapaEvidence} from './chapa-legacy-recovery';
import type {PaymentSessionAuthorizer} from './creation-eligibility';

type Tx=Prisma.TransactionClient;
type Authorize=PaymentSessionAuthorizer;
const money=z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
const createSchema=z.discriminatedUnion('purpose',[
 z.object({key:z.string().uuid(),purpose:z.literal('TOP_UP'),amount:money}).strict(),
 z.object({key:z.string().uuid(),purpose:z.literal('BID'),auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),amount:pointsSchema,feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional()}).strict(),
]);
const pending=['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED'];
const openStatuses=[...pending,'NEEDS_REVIEW'];
const earlyWalletReturnWindowMs=5000;
const telebirrEarlyVerificationWindowMs=30000;
// The first attempt initializes the payment. Claims 2 through 4 are the
// first three verification checks, with two fast intervals between them.
const lastEarlyTelebirrVerificationAttempt=4;
const walletReturnThrottled=new Error('The early wallet return verification budget is exhausted.');
const aliasScope='CHAPA_CHECKOUT_ALIAS';
const aliasResult=z.object({checkoutId:z.string().uuid()}).strict();
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const paid=(order:ChapaCheckout)=>order.creditJournalId!==null;
/** Historical attempts remain readable, and can be reconciled only when their
 * explicit original-v1 recovery configuration is available. Never use v2 keys. */
export function unsupportedLegacyChapaCheckout(order:{flowVersion?:number;initialization:unknown}){
 return isLegacyChapaCheckout(order)&&!chapaLegacyRecoveryAvailability().recoveryEnabled;
}
const after=(ms:number)=>new Date(Date.now()+ms);
// Observe committed webhook results separately from the provider retry schedule.
const STATUS_REFRESH_MS=2000;

function checkoutPollDelay(order:ChapaCheckout){
 // A private provider retry deadline blocks even an early native-wallet return.
 // Avoid serving duplicate owned status reads throughout that same cooldown.
 if(!isCurrentDirectCheckout(order)||!order.verificationRetryAfter)return STATUS_REFRESH_MS;
 return Math.max(STATUS_REFRESH_MS,order.verificationRetryAfter.getTime()-Date.now());
}

export {walletBidsEnabled} from '../wallet/policy';
export function publicChapaAvailability(){const value=currentDirectAvailability();return {enabled:value.enabled,configured:value.configured,mode:value.mode,apiVersion:'v2' as const,walletBidsEnabled:walletBidsEnabled(),minTopup:CHAPA_TOPUP_MIN_ETB,maxTopup:CHAPA_TOPUP_MAX_ETB,reason:value.enabled?null:'Secure payments are not configured.'}}
const context={auction:{select:{publicCode:true,status:true,endsAt:true,product:{select:{title:true,titleAm:true}}}}} satisfies Prisma.ChapaCheckoutInclude;
type OrderContext={auction?:{publicCode:number;status:string;endsAt:Date|null;product:{title:string;titleAm:string|null}|null}|null};
export function ownChapaCheckout(order:ChapaCheckout&OrderContext){
 const initializationIssue=!paid(order)&&!order.checkoutUrl&&(order.initializationErrorCode||order.initializationHttpStatus)?classifyChapaApiError(order.initializationHttpStatus,order.initializationErrorCode):null;
 const initialization=order.initialization as Record<string,unknown>,batchSnapshot=initialization.batch as {lines?:{number:string}[]}|undefined,batch=batchSnapshot?{...batchSnapshot,status:order.status==='BID_ACCEPTED'?'ACCEPTED':'QUOTED'}:null;
 // Full child receipts stay immutable in storage for audit/reconciliation. An
 // owned status response needs one wallet/own-bid snapshot, not 100 repeated
 // prefix histories; preserve the original single-bid DTO for old consumers.
 const receipt=order.batchId&&order.receipt&&typeof order.receipt==='object'&&!Array.isArray(order.receipt)?Object.fromEntries(Object.entries(order.receipt).filter(([key])=>['bid','hold','charge','wallet','remainingSubmissions','ownBids'].includes(key))):order.receipt;
 let payerPhoneMasked:string|null=null;try{if(order.payerPhoneCipher&&order.phoneBotId)payerPhoneMasked=maskPhoneDisplay(decryptPhone(order.payerPhoneCipher,order.phoneBotId))}catch{}
 return {depositBonus:ownDepositBonus(order),id:order.id,flowVersion:order.flowVersion,apiVersion:isLegacyChapaCheckout(order)?'legacy' as const:'v2' as const,unsupportedLegacy:unsupportedLegacyChapaCheckout(order),legacyRecoveryAvailable:legacyChapaRecoveryAvailable(order),purpose:order.purpose,mode:order.mode,amount:centsToEtb(order.amountCents),amountCents:order.amountCents.toString(),currency:order.currency,status:order.status,reason:order.reason,providerReasonCode:publicChapaPaymentReason(order),providerCancelledBy:publicChapaCancelledBy(order),authorizationReasonCode:publicChapaAuthorizationReason(order),providerStatus:order.providerStatus??(paid(order)?'SUCCESS':null),verificationState:order.verificationState,completionSignalPending:!paid(order)&&!!order.verificationCompletionStatus&&order.verificationSignalVersion>order.verificationHandledSignalVersion,initializationIssue,initializationReasonCode:order.chargeType==='DIRECT'||isV2InlineCheckout(order)&&order.chargeType==='INLINE'?safeChapaPaymentReason(order.initializationErrorCode):null,merchantReference:order.merchantReference,paymentMethod:order.paymentMethod,chargeType:order.chargeType??'HOSTED',authType:order.authType??null,authorizationReference:order.authorizationReference??null,payerPhoneMasked,batch:batch??null,batchNumbers:batch?.lines?.map(line=>line.number)??[],auctionTitle:order.auction?.product?.title??null,auctionTitleAm:order.auction?.product?.titleAm??null,auctionCode:order.auction?.publicCode?.toString()??null,auctionStatus:order.auction?.status??null,auctionEndsAt:order.auction?.endsAt?.toISOString()??null,checkoutUrl:order.checkoutUrl,auctionSlug:order.auctionSlug,bidNumber:order.bidNumber?.toString()??null,feeVersion:order.feeVersion,grossFee:order.grossFee?.toString()??null,discountPoints:order.discountPoints.toString(),createdAt:order.createdAt.toISOString(),updatedAt:order.updatedAt.toISOString(),expiresAt:order.expiresAt.toISOString(),pollAfterMs:checkoutPollDelay(order),fundsPreserved:paid(order)&&order.status==='NEEDS_REVIEW',receipt};
}
export async function eligible(tx:Tx,userId:string){
 const [row]=await tx.$queryRaw<{telegramId:string|null;contactTelegramId:string|null;botId:string|null;phoneCipher:string|null;revokedAt:Date|null;staffId:string|null;suspended:boolean}[]>`SELECT u."telegramId",c."telegramId" AS "contactTelegramId",c."botId",c."phoneCipher",c."revokedAt",s."userId" AS "staffId",COALESCE(r.suspended,false) AS suspended FROM "user" u LEFT JOIN "TelegramOwnContact" c ON c."userId"=u.id LEFT JOIN "StaffMember" s ON s."userId"=u.id LEFT JOIN "UserRestriction" r ON r."userId"=u.id WHERE u.id=${userId}`;
 if(!row)throw Error('CONTACT_REQUIRED');
 if(!row.telegramId)await assertPlayerContact(tx,userId);
 else if(!row.contactTelegramId||row.revokedAt||row.contactTelegramId!==row.telegramId||row.botId!==contactBotId())throw Error('CONTACT_REQUIRED');
 if(row.staffId||row.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Payments are unavailable for this account. Existing funds remain safe.');
 if(!row.phoneCipher||!row.botId)throw Error('CONTACT_REQUIRED');
 return {phoneCipher:row.phoneCipher,botId:row.botId};
}
function initializationInput(order:ChapaCheckout):ChapaCreate{
 // Hosted checkout collects the payer's contact details. The verified Telegram
 // contact still gates Lowwin access. Payer contact and payment method are
 // entered on Chapa's hosted page without a Lowwin prefill.
 return order.initialization as unknown as ChapaCreate;
}
function sameConfiguration(order:ChapaCheckout){const value=isLegacyChapaCheckout(order)?chapaLegacyRecoveryAvailability():chapaAvailability();return value.mode===order.mode&&value.credentialFingerprint===order.credentialFingerprint}

/** The outer payment transaction already owns the wallet advisory key. Keep
 * projection locking before reading balances, without rewriting complete accounts. */
async function paymentCreditAccounts(tx:Tx,userId:string){
 // Only immutable account identities come from this snapshot. Any later
 // balance reads happen in a fresh statement after the wallet guard is held.
 const [ready]=await tx.$queryRaw<{walletId:string;availableId:string;issuanceId:string}[]>`
  WITH locked_wallet AS MATERIALIZED (
   SELECT id,lock_wallet_hold_state(id) FROM "Wallet" WHERE "userId"=${userId}
  ) SELECT w.id AS "walletId",a.id AS "availableId",p.id AS "issuanceId"
  FROM locked_wallet w
  JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='AVAILABLE'
  JOIN "LedgerAccount" h ON h."walletId"=w.id AND h.kind='HELD'
  JOIN "LedgerAccount" p ON p.name='platform:issuance'`;
 if(ready)return {availableId:ready.availableId,issuanceId:ready.issuanceId,walletId:ready.walletId};
 const wallet=await ensureWallet(tx,userId);await seedPlatformAccounts(tx);
 const accounts=await tx.ledgerAccount.findMany({where:{OR:[{walletId:wallet.id,kind:'AVAILABLE'},{name:'platform:issuance'}]},select:{id:true,name:true,kind:true,walletId:true}});
 const available=accounts.find(a=>a.walletId===wallet.id&&a.kind==='AVAILABLE'),issuance=accounts.find(a=>a.name==='platform:issuance');
 if(!available||!issuance)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','The payment accounts could not be loaded. Retry this same payment.');
 return {availableId:available.id,issuanceId:issuance.id,walletId:wallet.id};
}

async function creditChapaPayment(tx:Tx,order:ChapaCheckout,chapaReference:string,evidenceHash:string){
 const {availableId,issuanceId,walletId}=await paymentCreditAccounts(tx,order.userId);
 const amount=centsToEtb(order.amountCents);
 const result={checkoutId:order.id,merchantReference:order.merchantReference,chapaReference,mode:order.mode,amountCents:String(order.amountCents),currency:'ETB'};
 if(!isCurrentDirectCheckout(order)||depositBonusQuote(order)){
  const operation=await tx.operation.create({data:{userId:order.userId,scope:'CHAPA_RECEIPT',key:order.id,requestHash:evidenceHash,result}});
  const credit=new Prisma.Decimal(amount);
  const journal=await tx.journal.create({data:{operationId:operation.id,kind:'CHAPA_RECEIPT',reference:`chapa:${order.merchantReference}`,postings:{create:[{accountId:issuanceId,delta:credit.negated()},{accountId:availableId,delta:credit}]}}});
  await creditDepositBonusInTransaction(tx,order,walletId,issuanceId,journal.id,evidenceHash);
  return journal.id;
 }
 const operationId=randomUUID(),journalId=randomUUID();
 // The normal ledger triggers still project and validate the two postings.
 // Explicit RETURNING dependencies keep all three writes ordered and atomic.
 const postings=await tx.$executeRaw`
  WITH new_operation AS (
   INSERT INTO "Operation" (id,"userId",scope,key,"requestHash",result)
   VALUES (${operationId},${order.userId},'CHAPA_RECEIPT',${order.id},${evidenceHash},${JSON.stringify(result)}::jsonb)
   RETURNING id
  ), new_journal AS (
   INSERT INTO "Journal" (id,"operationId",kind,reference)
   SELECT ${journalId},id,'CHAPA_RECEIPT',${`chapa:${order.merchantReference}`} FROM new_operation RETURNING id
  ) INSERT INTO "Posting" (id,"journalId","accountId",delta)
  SELECT leg.id,j.id,leg.account,leg.delta FROM new_journal j
  CROSS JOIN (VALUES (${randomUUID()},${issuanceId},-${amount}::numeric),(${randomUUID()},${availableId},${amount}::numeric)) leg(id,account,delta)`;
 if(postings!==2)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Payment credit could not be recorded. Retry this same payment.');
 return journalId;
}

/** Persist the intent BEFORE provider HTTP. All retries reuse this exact body,
 * reference and idempotency key, including an ambiguous initialization timeout. */
export async function createChapaCheckout(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport){
 const health=requireChapa(),body=createSchema.parse(raw),normalized=body.purpose==='TOP_UP'?{...body,amount:etbToCents(body.amount).toString()}:{...body,amount:body.amount.toString()},requestHash=chapaHash(JSON.stringify(normalized));
 const order=await measureChapa('database',()=>client.$transaction(async tx=>{
  const halted=await auctionMaintenance(tx);
  if(body.purpose==='BID')await tx.$queryRaw`SELECT id FROM "Auction" WHERE slug=${body.auctionSlug} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  if(reauthorize)await reauthorize(tx);const contact=await eligible(tx,userId);
  const alias=await tx.operation.findUnique({where:{userId_scope_key:{userId,scope:aliasScope,key:body.key}}});
  if(alias){
   if(alias.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Retry the original payment details with this request key.');
   const result=aliasResult.safeParse(alias.result);if(!result.success)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','This payment retry needs review. Keep its payment ID.');
   const original=await tx.chapaCheckout.findFirst({where:{id:result.data.checkoutId,userId}});if(!original)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
   return original;
  }
  const previous=await tx.chapaCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
  if(previous){if(previous.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Retry the original payment details with this request key.');return previous}
  if(transport===chapaTransport)throw new ChapaError(410,'PAYMENT_VERSION_RETIRED','Start a new payment through the current secure checkout.');
  // A new command key deliberately creates a fresh attempt. Historical aliases
  // stay permanently bound, and transport replay keeps the original key.
  if(halted)throw new ChapaError(503,'AUCTIONS_PAUSED','New checkouts are paused for auction maintenance. Existing payments can still be checked.');
  if(await tx.chapaCheckout.count({where:{userId,createdAt:{gte:new Date(Date.now()-3600000)}}})>=24)throw new ChapaError(429,'RATE_LIMITED','Too many new payment attempts. Check your existing payment or retry later.');
  let amountCents:bigint,auctionId:string|null=null,bidNumber:Prisma.Decimal|null=null,grossFee:Prisma.Decimal|null=null,discountPoints=new Prisma.Decimal(0);
  if(body.purpose==='TOP_UP'){
   amountCents=etbToCents(body.amount);if(amountCents<100n||amountCents>4320000n)throw new ChapaError(422,'INVALID_AMOUNT','Top up between 1.00 and 43,200.00 ETB.');
  }else{
   if(await tx.operation.findUnique({where:{userId_scope_key:{userId,scope:'BID',key:body.key}}}))throw new ChapaError(409,'BID_ALREADY_ACCEPTED','This bid is already processed. Check My Bids.');
   const a=await tx.auction.findUnique({where:{slug:body.auctionSlug},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},product:{include:{category:true}},category:true}}),[{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
   if(!a?.publishedAt||a.publishedAt>now||!a.startsAt||a.startsAt>now||!a.endsAt||a.endsAt.getTime()-now.getTime()<30000||!['SCHEDULED','LIVE'].includes(a.status)||!a.product?.visible||!a.product.category.visible||!a.category?.visible)throw new ChapaError(409,'AUCTION_CLOSED','The auction is closed or too close to its deadline to start checkout.');
   if(a.isDemo||a.testRunId||a.product.isDemo||!a.terms||!isSubmissionFeeOnly(a.terms.ruleVersion))throw new ChapaError(409,'LEGACY_TERMS','This checkout supports real submission-fee auctions only. Published older terms remain unchanged.');
   const fee=a.feeRevisions[0],terms=a.terms;if(!fee||fee.version!==body.feeVersion)throw new ChapaError(409,'TERMS_CHANGED','Review the current submission fee before paying.');
   if(body.amount.lt(1)||body.amount.lt(terms.minPoints)||terms.maxPoints!==null&&body.amount.gt(terms.maxPoints)||!body.amount.sub(terms.minPoints).mod(terms.stepPoints).isZero())throw new ChapaError(422,'INVALID_AMOUNT','Choose a number within this auction’s published terms.');
   const own=await tx.bid.findMany({where:{userId,auctionId:a.id},select:{amount:true}});
   if(own.some(b=>b.amount.eq(body.amount)))throw new ChapaError(409,'OWN_DUPLICATE','You already submitted this number.');
   if(own.length>=terms.maxDistinctBids)throw new ChapaError(409,'CAP_REACHED','You reached this auction’s submission limit.');
   grossFee=fee.feePoints;
   if(body.couponId)discountPoints=(await lockReferralDiscountInTransaction(tx,userId,body.couponId,grossFee,terms.ruleVersion)).discountPoints;
   amountCents=etbToCents(grossFee.sub(discountPoints).toString());
   if(amountCents<100n||amountCents>4320000n)throw new ChapaError(422,'CHAPA_MINIMUM','This fee is below Chapa’s 1.00 ETB minimum or above its configured limit. Use your wallet for this submission fee.');
   auctionId=a.id;bidNumber=body.amount;
  }
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`;
  const returnUrl=new URL(`/payments/chapa/return?checkout=${id}`,process.env.MINI_APP_URL).toString();
  const initialization:ChapaCreate={amountCents:amountCents.toString(),merchantReference,idempotencyKey:`lowwin:${id}`,returnUrl,returnUrlVersion:1,...chapaMethodCatalog.preferences(amountCents)};
  return tx.chapaCheckout.create({data:{id,userId,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,key:body.key,requestHash,merchantReference,amountCents,initialization:json(initialization),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,auctionId,auctionSlug:body.purpose==='BID'?body.auctionSlug:null,bidNumber,grossFee,discountPoints,feeVersion:body.purpose==='BID'?body.feeVersion:null,couponId:body.purpose==='BID'?body.couponId:null,expiresAt:after(86400000)}});
 },PAYMENT_TRANSACTION_OPTIONS));
 if(!paid(order)&&!order.checkoutUrl&&sameConfiguration(order)){const initialized=await initializeChapaCheckout(client,order.id,transport,order);if(initialized)return ownChapaCheckout(initialized);return getChapaCheckout(client,userId,order.id)}
 return ownChapaCheckout(order);
}

async function initializeChapaCheckout(client:PrismaClient,id:string,transport:ChapaTransport,persisted?:ChapaCheckout){
 if(!chapaAvailability().enabled)return;
 const snapshot=persisted??await measureChapa('database',()=>client.chapaCheckout.findUniqueOrThrow({where:{id}}));if(paid(snapshot)||snapshot.checkoutUrl||!sameConfiguration(snapshot)||!['SUBMITTING','PENDING'].includes(snapshot.status)||classifyChapaApiError(snapshot.initializationHttpStatus,snapshot.initializationErrorCode)==='state'||snapshot.reason&&!['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_REFERENCE_UNAVAILABLE','PROVIDER_EVENT_RECEIVED'].includes(snapshot.reason))return;
 const initializationState={id,creditJournalId:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},OR:[{reason:null},{reason:{in:['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_REFERENCE_UNAVAILABLE','PROVIDER_EVENT_RECEIVED']}}]};
 // Take the barrier first, then use a fresh statement snapshot for the halt
 // check and lease update. A single CTE could miss a halt committed while it
 // waited for that barrier. Provider HTTP stays outside this transaction.
 const acquired=await measureChapa('database',()=>client.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
 return tx.$executeRaw`UPDATE "ChapaCheckout" c SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '20 seconds',"nextCheckAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '20 seconds',"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
 WHERE c.id=${id} AND c."creditJournalId" IS NULL AND c."checkoutUrl" IS NULL AND c.status IN ('SUBMITTING','PENDING')
 AND (c.reason IS NULL OR c.reason IN ('INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_REFERENCE_UNAVAILABLE','PROVIDER_EVENT_RECEIVED'))
 AND COALESCE(c."initializationHttpStatus",0)<>409
 AND NOT (COALESCE(c."initializationHttpStatus",0) IN (400,422) AND COALESCE(c."initializationErrorCode",'')='INVALID_STATE')
 AND (c."leaseUntil" IS NULL OR c."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
 AND COALESCE((SELECT action<>'AUCTIONS_MAINTENANCE_HALTED' FROM "AdminAudit" WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1),true)`;
 },PAYMENT_TRANSACTION_OPTIONS));
 if(!acquired)return;
 try{
  const response=createdChapaSession(await measureChapa('initialize',()=>transport.create(initializationInput(snapshot))));
  if(!response)throw new Error('Invalid initialization evidence');
  const rows=await measureChapa('database',()=>client.chapaCheckout.updateManyAndReturn({where:initializationState,data:{checkoutUrl:response.checkoutUrl,chapaReference:response.chapaReference,...(response.createdAt?{providerCreatedAt:response.createdAt}:{}),...(response.expiresAt?{expiresAt:response.expiresAt}:{}),status:'PENDING',reason:'AWAITING_PROVIDER',initializationErrorCode:null,initializationHttpStatus:null,leaseUntil:null,nextCheckAt:after(5000)}}));return rows[0];
 }catch(error){
  const rejected=error instanceof ChapaProviderError&&error.definiteRejection;
  const conflict=error instanceof ChapaProviderError&&error.category==='state';
  const rows=await measureChapa('database',()=>client.chapaCheckout.updateManyAndReturn({where:initializationState,data:{status:rejected?'NEEDS_REVIEW':'PENDING',reason:conflict?'INITIALIZATION_CONFLICT':rejected?'INITIALIZATION_REJECTED':'INITIALIZATION_PENDING',initializationErrorCode:error instanceof ChapaProviderError?error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null,leaseUntil:null,nextCheckAt:after(conflict?0:15000)}}));return rows[0];
 }
}
export async function getChapaCheckout(client:PrismaClient,userId:string,id:string){
 const order=await measureChapa('database',()=>client.chapaCheckout.findFirst({where:{id:z.string().uuid().parse(id),userId},include:context}));if(!order)throw new ChapaError(404,'NOT_FOUND','Payment not found.');return ownChapaCheckout(order);
}
export async function listChapaCheckouts(client:PrismaClient,userId:string,purpose?:'TOP_UP'|'BID',page=1,unaccepted=false,statusFilter:'all'|'pending'|'failed'|'cancelled'|'review'='all'){
 const filter=z.enum(['TOP_UP','BID']).optional().parse(purpose);page=z.number().int().min(1).max(10000).parse(page);
 const state=z.enum(['all','pending','failed','cancelled','review']).parse(statusFilter);
 if(state!=='all'&&(!unaccepted||filter!=='BID'))throw new ChapaError(422,'INVALID_INPUT','Choose unaccepted bid payments for this filter.');
 if(process.env.CHAPA_SCHEMA_READY!=='true')return {items:[],page,nextPage:null};
 const statuses={pending:['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED'],failed:['FAILED','INCOMPLETE','EXPIRED','BLOCKED'],cancelled:['CANCELLED'],review:['NEEDS_REVIEW']} as const;
 const rows=await client.chapaCheckout.findMany({where:{userId,...(filter?{purpose:filter}:{}),...(unaccepted?{purpose:'BID',bidId:null}:{}),...(state==='all'?{}:{...(state==='review'?{}:{creditJournalId:null}),status:{in:[...statuses[state]]}})},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:21,include:context});
 return {items:rows.slice(0,20).map(ownChapaCheckout),page,nextPage:rows.length>20?page+1:null};
}
async function recordChapaVerificationSignal(client:PrismaClient,snapshot:ChapaCheckout,feedback?:ChapaAuthorizationFeedback,completion?:ChapaCompletionStatus){
 const feedbackReason=feedback?chapaAuthorizationFeedbackReason(feedback)??'PAYMENT_NOT_COMPLETED':null;
 const [requested]=await measureChapa('database',()=>client.$queryRaw<Pick<ChapaCheckout,'verificationSignalVersion'|'verificationRetryAfter'|'verificationCompletionStatus'|'nextCheckAt'|'reason'|'status'|'updatedAt'>[]>`
  UPDATE "ChapaCheckout" SET "verificationSignalVersion"="verificationSignalVersion"+1,
   "reason"=CASE WHEN ${!!feedback} AND "status" IN ('SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED')
    AND "verificationState"<>'MISMATCH' AND ("providerStatus" IS NULL OR "providerStatus" IN ('PENDING','AUTH_NEEDED'))
    AND ("reason" IS NULL OR left("reason",6)<>'CHAPA_' OR left("reason",20)='CHAPA_AUTHORIZATION_')
    THEN ${feedbackReason} ELSE "reason" END,
   "verificationCompletionStatus"=CASE WHEN "verificationCompletionStatus"='SUCCESS' THEN 'SUCCESS' ELSE COALESCE(${completion??null},"verificationCompletionStatus") END,
   "status"=CASE WHEN ("verificationCompletionStatus" IS NOT NULL OR ${completion??null}::text IS NOT NULL) AND "status" IN ('FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED') THEN 'NEEDS_REVIEW' ELSE "status" END,
   "nextCheckAt"=GREATEST(COALESCE("verificationRetryAfter",TIMESTAMP 'epoch'),clock_timestamp() AT TIME ZONE 'UTC'),
   "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC'
  WHERE id=${snapshot.id} AND "userId"=${snapshot.userId} AND "creditJournalId" IS NULL
  RETURNING "verificationSignalVersion","verificationRetryAfter","verificationCompletionStatus","nextCheckAt","reason","status","updatedAt"`);
 if(requested){
  const publicChange=requested.reason!==snapshot.reason||requested.verificationCompletionStatus!==snapshot.verificationCompletionStatus;
  Object.assign(snapshot,requested);
  if(publicChange)void publishChapaCommitted(snapshot.id).catch(()=>{});
 }
}
export async function verifyChapaCheckout(client:PrismaClient,id:string,userId?:string,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport,eventCheck:boolean|'webhook'=false,providedAuthorizationFeedback?:ChapaAuthorizationFeedback,completionSignal?:ChapaCompletionStatus){
 return runChapaVerification(client,id,userId,reauthorize,transport,eventCheck,providedAuthorizationFeedback,completionSignal);
}

/** Only the authenticated webhook worker supplies this server-read checkout. */
export function verifyChapaWebhookCheckout(client:PrismaClient,snapshot:ChapaCheckout,transport:ChapaTransport,completion?:ChapaCompletionStatus){
 return runChapaVerification(client,snapshot.id,undefined,undefined,transport,'webhook',undefined,completion,snapshot);
}

async function readVerificationCheckout(client:PrismaClient,id:string,userId?:string){
 z.string().uuid().parse(id);
 const snapshot=await measureChapa('database',()=>client.chapaCheckout.findFirst({where:{id,...(userId?{userId}:{})}}));
 if(!snapshot)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 return snapshot;
}

/** The route can read the owned order alongside the request limit. Only the
 * continuation can claim a fresh verification lease or call Chapa. */
export async function prepareOwnedChapaVerification(client:PrismaClient,id:string,userId:string,transport:ChapaTransport=chapaTransport,walletReturn=false){
 const snapshot=await readVerificationCheckout(client,id,userId);
 return (reauthorize:Authorize)=>runChapaVerification(client,id,userId,reauthorize,transport,false,undefined,undefined,snapshot,walletReturn);
}

async function runChapaVerification(client:PrismaClient,id:string,userId:string|undefined,reauthorize:Authorize|undefined,transport:ChapaTransport,eventCheck:boolean|'webhook',providedAuthorizationFeedback:ChapaAuthorizationFeedback|undefined,completionSignal:ChapaCompletionStatus|undefined,snapshot?:ChapaCheckout,walletReturn=false){
 const work={changed:false,deferred:false};
 try{
  let result=await verifyChapaCheckoutOnce(client,id,userId,reauthorize,transport,eventCheck,providedAuthorizationFeedback,work,completionSignal,snapshot,walletReturn);
  if(work.changed){void publishChapaCommitted(id).catch(()=>{});work.changed=false}
  // One retained signal gets a prompt private recheck, without another public
  // validation. Any further signal remains durably due for another caller or
  // worker; this request cannot turn into an unrestricted provider loop.
  if(work.deferred){work.deferred=false;result=await verifyChapaCheckoutOnce(client,id,userId,reauthorize,transport,'deferred',undefined,work)}
  return result;
 }finally{
  // Every transaction/autocommit above has finished before publishing. Redis
  // delivery is supplementary: a failed notification cannot undo payment.
  if(work.changed)void publishChapaCommitted(id).catch(()=>{});
 }
}
async function verifyChapaCheckoutOnce(client:PrismaClient,id:string,userId:string|undefined,reauthorize:Authorize|undefined,transport:ChapaTransport,eventCheck:boolean|'webhook'|'deferred',providedAuthorizationFeedback:ChapaAuthorizationFeedback|undefined,work:{changed:boolean;deferred:boolean},completionSignal?:ChapaCompletionStatus,ownedSnapshot?:ChapaCheckout,walletReturn=false){
 const snapshot=ownedSnapshot??await readVerificationCheckout(client,id,userId);
 if(unsupportedLegacyChapaCheckout(snapshot))return ownChapaCheckout(snapshot);
 const legacy=isLegacyChapaCheckout(snapshot),inlineV2=isV2InlineCheckout(snapshot),currentV2=isCurrentV2Checkout(snapshot),currentDirect=isCurrentDirectCheckout(snapshot);
 if(!legacy)requireChapa('recover');
 if(legacy&&transport!==chapaTransport&&(!('protocol' in transport)||transport.protocol!=='v1-recovery'))throw new ChapaError(503,'CONFIGURATION_CHANGED','Historical payments require their original Chapa v1 verification transport.');
 // Select the saved protocol, never the currently preferred creation flow.
 // Public-key authorization refresh cannot replace private-key verification.
 const selectedTransport=legacy&&transport===chapaTransport?legacyChapaRecoveryTransport:inlineV2&&transport===chapaTransport?chapaInlineTransport:transport;
 if(paid(snapshot))return ownChapaCheckout(snapshot);
 const recoveryBinding=sameConfiguration(snapshot)?null:legacy?await approvedLegacyRecoveryBinding(client,snapshot):await approvedRecoveryBinding(client,snapshot);
 if(!sameConfiguration(snapshot)&&!recoveryBinding)throw new ChapaError(503,'CONFIGURATION_CHANGED','This payment needs its original Chapa configuration or a reviewed recovery authorization. Keep its payment ID.');
 let now=Date.now();
 if(eventCheck&&eventCheck!=='deferred'){
  // Record the hint before checking the current lease. Incrementing this row
  // serializes with settlement, so an event cannot disappear between the
  // owner's last read and commit. Ownership/configuration were checked above.
  // Read the current retry deadline under this UPDATE's row lock. A snapshot
  // read before a429 committed must not move its due time back to now. Persist
  // bound OTP feedback too: a busy verifier must not lose the correction/reason.
  await recordChapaVerificationSignal(client,snapshot,providedAuthorizationFeedback,completionSignal);
  now=Date.now();
 }
 // Returning from the native wallet can bring forward one owned USSD check.
 // The hint is scheduling only. Current leases and provider backoff win.
 const waitingForPoll=snapshot.nextCheckAt.getTime()>now;
 const openDirectAuthorization=currentDirect&&pending.includes(snapshot.status)&&snapshot.expiresAt.getTime()>now&&shouldRefreshChapaAuthorization(snapshot);
 const returnedFromWallet=!eventCheck&&walletReturn&&!!userId&&!!reauthorize&&openDirectAuthorization;
 const earlyReturn=waitingForPoll&&returnedFromWallet;
 const telebirrAuthorization=openDirectAuthorization&&snapshot.paymentMethod==='telebirr';
 const earlyTelebirrCheck=!eventCheck&&telebirrAuthorization&&snapshot.attempts<lastEarlyTelebirrVerificationAttempt&&now-snapshot.createdAt.getTime()<telebirrEarlyVerificationWindowMs;
 // Only a matched private pending response writes this due time relative
 // to its private check. A normal retry must actually read private status.
 const shortTelebirrFollowUp=!eventCheck&&telebirrAuthorization&&snapshot.verificationState==='VERIFIED'&&
  ['PENDING','AUTH_NEEDED'].includes(snapshot.providerStatus??'')&&!!snapshot.lastPrivateCheckAt&&
  snapshot.nextCheckAt.getTime()===snapshot.lastPrivateCheckAt.getTime()+STATUS_REFRESH_MS;
 const privateFirst=returnedFromWallet||earlyTelebirrCheck||shortTelebirrFollowUp;
 if(snapshot.leaseUntil&&snapshot.leaseUntil.getTime()>now||snapshot.verificationRetryAfter&&snapshot.verificationRetryAfter.getTime()>now||!eventCheck&&waitingForPoll&&!earlyReturn)return ownChapaCheckout(snapshot);
 let verificationLease=after(CHAPA_VERIFICATION_LEASE_MS);const handledSignal=snapshot.verificationSignalVersion??0;
 const claimWhere=():Prisma.ChapaCheckoutWhereInput=>{
  const due=new Date();
  return {id,creditJournalId:null,
   ...(earlyReturn?{userId,status:snapshot.status,nextCheckAt:snapshot.nextCheckAt,authorizationReference:snapshot.authorizationReference}:eventCheck?{}:{nextCheckAt:{lte:due}}),
   OR:[{leaseUntil:null},{leaseUntil:{lte:due}}],AND:[{OR:[{verificationRetryAfter:null},{verificationRetryAfter:{lte:due}}]}]};
 };
 const claimData=()=>({leaseUntil:verificationLease,attempts:{increment:1}});
 // A normally due Direct check can claim the exact owned row in one statement.
 // Interactive checks revalidate the signed session in that statement. The
 // background sweep already has the server-owned checkout and its user ID.
 // Early returns still need the transaction that reserves their extra quota.
 // A conflict falls back to the existing locked path.
 const backgroundFilter=userId===undefined&&!reauthorize?()=>({userId:snapshot.userId}):undefined;
 const verificationFilter=currentDirect&&!eventCheck&&!earlyReturn&&!recoveryBinding
  ?reauthorize?.directVerificationFilter??backgroundFilter
  :undefined;
 const measureClaim=<T>(operation:()=>Promise<T>)=>measureChapa('verify_claim',()=>measureChapa('database',operation));
 const [claimed]=verificationFilter?await measureClaim(()=>client.chapaCheckout.updateManyAndReturn({
  where:{AND:[claimWhere(),verificationFilter(),{updatedAt:snapshot.updatedAt}]},data:claimData(),
 })):[];
 if(!claimed){
  const acquired=await measureClaim(()=>client.$transaction(async tx=>{
   if(reauthorize)await reauthorize(tx);
   verificationLease=after(CHAPA_VERIFICATION_LEASE_MS);
   const claim=await tx.chapaCheckout.updateMany({where:claimWhere(),data:claimData()});
   if(claim.count&&earlyReturn&&!await allowIdentityRequest(tx,'chapa-wallet-return',id,1,earlyWalletReturnWindowMs))throw walletReturnThrottled;
   return claim;
  },PAYMENT_TRANSACTION_OPTIONS)).catch(error=>{if(error===walletReturnThrottled)return null;throw error});
  if(!acquired)return ownChapaCheckout(snapshot);
  if(!acquired.count)return ownChapaCheckout(await measureChapa('database',()=>client.chapaCheckout.findUniqueOrThrow({where:{id}})));
 }
 work.changed=true;
 // A pending private-first lookup can need both the usual refresh and a
 // second private lookup. Reserve time for that additional bounded request.
 const minimumLeaseRemaining=CHAPA_MIN_VERIFICATION_LEASE_REMAINING_MS+(privateFirst?10000:0);
 if(verificationLease.getTime()-Date.now()<minimumLeaseRemaining){
  const renewedLease=after(CHAPA_VERIFICATION_LEASE_MS);
  const renewed=await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{id,creditJournalId:null,leaseUntil:verificationLease},data:{leaseUntil:renewedLease}}));
  if(!renewed.count)return getChapaCheckout(client,snapshot.userId,id);
  verificationLease=renewedLease;
  if(verificationLease.getTime()-Date.now()<minimumLeaseRemaining){
   await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{id,creditJournalId:null,leaseUntil:verificationLease},data:{leaseUntil:null}}));
   return getChapaCheckout(client,snapshot.userId,id);
  }
 }
 // A process can pause beyond the lease while provider HTTP is in flight.
 // Fence every resulting write by our claimed value: an old request must not
 // clear another verifier's lease or replace evidence recorded by its owner.
 const ownedVerification={id,creditJournalId:null,leaseUntil:verificationLease};
 const readPrivateProof=async()=>{
  const raw=await measureChapa('verify',()=>selectedTransport.lookup(snapshot.merchantReference));
  return {raw,checkedAt:new Date()};
 };
 let privateProof:Awaited<ReturnType<typeof readPrivateProof>>|undefined,authorizationFeedback=providedAuthorizationFeedback;
 try{
  // USSD polling refreshes the provider's charge state. An authenticated event
  // or its retained, unhandled Direct5 terminal signal already requests private
  // verification. Ask for private evidence first after an owned wallet return
  // and during the initial Telebirr checks, even when no resume event arrives.
  const authorizationFlow=snapshot.chargeType==='DIRECT'||inlineV2&&snapshot.chargeType==='INLINE';
  const retainedDirectCompletion=currentDirect&&chapaCompletionStatus(snapshot.verificationCompletionStatus)!==null&&handledSignal>snapshot.verificationHandledSignalVersion;
  if(privateFirst&&!retainedDirectCompletion)try{
   privateProof=await readPrivateProof();
  }catch(error){
   // The merchant reference can briefly be unavailable before the wallet
   // authorization is visible. Let the usual refresh reconcile that case.
   if(!(error instanceof ChapaProviderError&&error.httpStatus===404&&selectedTransport.validate))throw error;
  }
  const firstStatus=privateProof&&parseChapaEvidence(privateProof.raw)?.status;
  const refreshAuthorization=!privateProof||firstStatus==='PENDING'||firstStatus==='AUTH_NEEDED';
  if(refreshAuthorization&&eventCheck!=='webhook'&&eventCheck!=='deferred'&&!retainedDirectCompletion&&authorizationFlow&&shouldRefreshChapaAuthorization(snapshot)&&selectedTransport.validate&&(!inlineV2||inlineTransportBinding(snapshot)))try{
   const validation=await measureChapa('validate',()=>selectedTransport.validate!({reference:snapshot.authorizationReference!,paymentMethod:snapshot.paymentMethod!}));
   authorizationFeedback=chapaAuthorizationFeedback(validation,snapshot);
   const validationProof=parseChapaEvidence(validation),completion=currentV2&&authorizationFeedback?chapaCompletionStatus(validationProof?.status):null;
   if(completion){
    // Only a new private lookup can confirm a terminal wallet refresh.
    privateProof=undefined;
    if(snapshot.verificationCompletionStatus!==completion||snapshot.verificationSignalVersion<=snapshot.verificationHandledSignalVersion)await recordChapaVerificationSignal(client,snapshot,authorizationFeedback,completion);
   }
   const matchingPending=currentV2&&authorizationFeedback?.kind==='waiting'&&validationProof?.status==='PENDING';
   if(!privateFirst&&canSkipChapaPrivateVerification(snapshot,matchingPending,!!eventCheck||handledSignal>(snapshot.verificationHandledSignalVersion??0))){
    const skipped=await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{...ownedVerification,verificationSignalVersion:handledSignal},data:{leaseUntil:null,nextCheckAt:after(chapaPendingVerificationDelay(snapshot,authorizationFlow)),verificationRetryAfter:null,...(publicChapaAuthorizationReason(snapshot)?{reason:'PAYMENT_NOT_COMPLETED'}:{})}}));
    if(skipped.count)return getChapaCheckout(client,snapshot.userId,id);
   }
  }catch(error){if(error instanceof ChapaProviderError&&error.httpStatus===429)throw error;authorizationFeedback=chapaAuthorizationErrorFeedback(error)}
  privateProof??=await readPrivateProof();
 }catch(error){
  const category=error instanceof ChapaProviderError?error.category:'temporary';
  const policy={configuration:{reason:'PROVIDER_CONFIGURATION_REQUIRED',delay:300000},reference:{reason:'PROVIDER_REFERENCE_UNAVAILABLE',delay:60000},state:{reason:'PROVIDER_STATE_UNAVAILABLE',delay:60000},request:{reason:'PROVIDER_REQUEST_REJECTED',delay:60000},temporary:{reason:'PROVIDER_CONFIRMATION_REQUIRED',delay:error instanceof ChapaProviderError&&error.httpStatus===429?60000:30000}}[category];
  // HTTP errors describe this API request, not whether the customer paid.
  // Keep verified provider state/reason and genuine mismatches authoritative,
  // including evidence that arrived while this HTTP request was in flight.
  const retryAt=after(policy.delay),schedule={leaseUntil:null,nextCheckAt:retryAt,verificationRetryAfter:retryAt},feedbackReason=authorizationFeedback?chapaAuthorizationFeedbackReason(authorizationFeedback):undefined;
  const feedbackPreserved=feedbackReason===undefined&&publicChapaAuthorizationReason(snapshot)?snapshot.reason:null;
  const recorded=await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{...ownedVerification,verificationSignalVersion:handledSignal,status:{in:pending},providerStatus:null,verificationState:{in:['UNVERIFIED','UNAVAILABLE']}},data:{...schedule,reason:feedbackReason??feedbackPreserved??policy.reason,verificationState:'UNAVAILABLE'}}));
  if(!recorded.count){
   // Keep the last privately verified state intact. Recognized authorization
   // feedback is supplementary and cannot replace a private reason/outcome.
   const feedbackRecorded=authorizationFeedback&&(authorizationFeedback.kind==='rejected'||publicChapaAuthorizationReason(snapshot))?await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{...ownedVerification,verificationSignalVersion:handledSignal,userId:snapshot.userId,status:{in:pending},verificationState:{not:'MISMATCH'},AND:[{OR:[{providerStatus:null},{providerStatus:{in:['PENDING','AUTH_NEEDED']}}]},{OR:[{reason:null},{NOT:{reason:{startsWith:'CHAPA_'}}},{reason:{startsWith:'CHAPA_AUTHORIZATION_'}}]}]},data:{...schedule,reason:feedbackReason??policy.reason}})):null;
   if(!feedbackRecorded?.count)await measureChapa('database',()=>client.chapaCheckout.updateMany({where:ownedVerification,data:schedule}));
  }
  return {...await getChapaCheckout(client,snapshot.userId,id),verificationUnavailable:true};
 }
 const {raw,checkedAt:privateCheckedAt}=privateProof;
 const evidence=legacy?parseLegacyChapaEvidence(raw):parseChapaEvidence(raw);
 let directBinding=true;
 if(snapshot.chargeType==='DIRECT'&&!currentDirect&&evidence){
  directBinding=(!snapshot.authorizationReference||!evidence.chapaReference||snapshot.authorizationReference===evidence.chapaReference)&&(!evidence.paymentMethod||snapshot.paymentMethod===evidence.paymentMethod);
  try{const expected=normalizePhone(decryptPhone(snapshot.payerPhoneCipher!,snapshot.phoneBotId!)),actual=evidence.customer?.phone_number?normalizePhone(evidence.customer.phone_number):null;directBinding=directBinding&&(!actual||actual===expected)&&(evidence.status!=='SUCCESS'||!!actual&&evidence.paymentMethod===snapshot.paymentMethod)}catch{directBinding=false}
 }
 if(currentV2&&['INLINE','DIRECT'].includes(snapshot.chargeType)&&evidence){
  directBinding=(!snapshot.authorizationReference||!evidence.chapaReference||snapshot.authorizationReference===evidence.chapaReference)&&(!evidence.paymentMethod||snapshot.paymentMethod===evidence.paymentMethod)&&(evidence.status!=='SUCCESS'||!!snapshot.paymentMethod&&evidence.paymentMethod===snapshot.paymentMethod);
  // Customer is optional in merchant verification. If supplied, its phone must
  // match the frozen payer; amount/currency/merchant/reference remain mandatory.
  if(evidence.customer?.phone_number)try{directBinding=directBinding&&normalizePhone(evidence.customer.phone_number)===normalizePhone(decryptPhone(snapshot.payerPhoneCipher!,snapshot.phoneBotId!))}catch{directBinding=false}
 }
 const matches=!!evidence&&directBinding&&evidence.merchantReference===snapshot.merchantReference&&evidence.amountCents===snapshot.amountCents.toString()&&evidence.currency===snapshot.currency&&(!evidence.chapaReference||!snapshot.chapaReference||snapshot.chapaReference===evidence.chapaReference||isChapaHostedSessionReference(snapshot.checkoutUrl,snapshot.chapaReference,snapshot.mode as 'test'|'live'))&&(!evidence.mode||evidence.mode===snapshot.mode)&&(!recoveryBinding||evidence.status==='SUCCESS'&&evidence.chapaReference===recoveryBinding.finalReference)&&matchesChapaMetadata(snapshot.initialization,evidence.meta,snapshot.id);
 if(!matches){await measureChapa('database',()=>client.chapaCheckout.updateMany({where:ownedVerification,data:{status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH',verificationState:'MISMATCH',leaseUntil:null,nextCheckAt:after(60000)}}));return getChapaCheckout(client,snapshot.userId,id)}
 const proof=evidence!;
 const webhookFeedback=legacy?{}:await measureChapa('database',()=>resolvedChapaWebhookReason(client,snapshot,proof));
 const verifiedFields=(order:ChapaCheckout,completionPending=false):Prisma.ChapaCheckoutUncheckedUpdateManyInput=>({
  // A provisional authorization reference never replaces a final payment reference.
  chapaReference:proof.status==='SUCCESS'?proof.chapaReference:order.chapaReference,
  paymentMethod:order.chargeType==='DIRECT'||isV2InlineCheckout(order)&&order.chargeType==='INLINE'?order.paymentMethod:proof.paymentMethod??(order.chargeType==='INLINE'?order.paymentMethod:null),
  processorReference:proof.processorReference??null,serviceFeeCents:proof.serviceFeeCents===undefined?null:BigInt(proof.serviceFeeCents),
  evidenceHash:proof.hash,providerStatus:proof.status,providerCancelledBy:webhookFeedback.cancelledBy??null,
  verificationState:'VERIFIED',leaseUntil:null,lastPrivateCheckAt:privateCheckedAt,verificationRetryAfter:null,
  verificationCompletionStatus:completionPending?order.verificationCompletionStatus:null,
  verificationHandledSignalVersion:proof.status==='SUCCESS'?order.verificationSignalVersion:completionPending?order.verificationHandledSignalVersion:Math.max(order.verificationHandledSignalVersion??0,handledSignal),
 });
 const uncreditedOutcome=(order:ChapaCheckout)=>{
  // Pending evidence cannot consume a retained completion. Only an
  // authoritative terminal lookup can handle its signal generation.
  const deferred=order.verificationSignalVersion>handledSignal;
  const waiting=proof.status==='PENDING'||proof.status==='AUTH_NEEDED';
  const completionPending=!!order.verificationCompletionStatus&&(deferred||waiting);
  const fastTelebirrFollowUp=waiting&&telebirrAuthorization&&order.expiresAt.getTime()>Date.now()&&
   (returnedFromWallet||earlyTelebirrCheck&&order.attempts<lastEarlyTelebirrVerificationAttempt);
  const authorizationFlow=order.chargeType==='DIRECT'||isV2InlineCheckout(order)&&order.chargeType==='INLINE';
  const delay=waiting||completionPending?chapaPendingVerificationDelay(order,authorizationFlow):300000;
  const nextCheckAt=deferred?new Date():fastTelebirrFollowUp?new Date(privateCheckedAt.getTime()+STATUS_REFRESH_MS):after(delay);
  const authorizationReason=deferred?publicChapaAuthorizationReason(order)?order.reason:null:authorizationFeedback?chapaAuthorizationFeedbackReason(authorizationFeedback):publicChapaAuthorizationReason(order)?order.reason:null;
  const providerReason=proof.reasonCode??webhookFeedback.reasonCode;
  return {deferred,data:{...verifiedFields(order,completionPending),status:completionPending&&!waiting?'NEEDS_REVIEW':proof.status,reason:providerReason?`CHAPA_${providerReason}`:waiting&&authorizationReason?authorizationReason:'PAYMENT_NOT_COMPLETED',nextCheckAt}};
 };
 if(claimed&&verificationFilter&&proof.status!=='SUCCESS'&&sameConfiguration(claimed)){
  // Only update the row we already checked. A newer webhook, lease, or
  // authorization change returns no rows and is handled under the row lock.
  const {data,deferred}=uncreditedOutcome(claimed);
  const [updated]=await measureChapa('settle',()=>measureChapa('database',()=>client.chapaCheckout.updateManyAndReturn({
   where:{AND:[ownedVerification,verificationFilter(),{
    updatedAt:claimed.updatedAt,verificationSignalVersion:claimed.verificationSignalVersion,
   }]},data,
  })));
  if(updated){work.deferred=deferred;return ownChapaCheckout(updated)}
 }
 return measureChapa('settle',()=>measureChapa('database',()=>client.$transaction(async tx=>{
  // Non-success Direct5 evidence only changes this checkout. Keep the exact
  // checkout lease and row lock below without queuing behind financial writes.
  if(!currentDirect||evidence!.status==='SUCCESS'){
   await lockAuctionMaintenance(tx);
   if(snapshot.auctionId)await tx.$executeRaw`
    WITH locked_auction AS MATERIALIZED (SELECT id FROM "Auction" WHERE id=${snapshot.auctionId} FOR UPDATE)
    SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${snapshot.userId}`},0))
    FROM (SELECT count(*) AS acquired FROM locked_auction) AS guard WHERE guard.acquired>=0`;
   else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${snapshot.userId}`},0))`;
  }
  const [order]=await tx.$queryRaw<ChapaCheckout[]>`SELECT * FROM "ChapaCheckout" WHERE id=${id} FOR UPDATE`;
  if(!order)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
  if(reauthorize)await reauthorize(tx);
  if(paid(order))return ownChapaCheckout(order);
  if(order.leaseUntil?.getTime()!==verificationLease.getTime())return ownChapaCheckout(order);
  const lockedBinding=sameConfiguration(order)?null:legacy?await approvedLegacyRecoveryBinding(tx,order):await approvedRecoveryBinding(tx,order);
  if(!sameConfiguration(order)&&(!lockedBinding||lockedBinding.finalReference!==evidence!.chapaReference))throw new ChapaError(503,'CONFIGURATION_CHANGED','Payment verification configuration changed. Keep this payment ID.');
  if(proof.status!=='SUCCESS'){
   const {data,deferred}=uncreditedOutcome(order);
   work.deferred=deferred;
   return ownChapaCheckout(await tx.chapaCheckout.update({where:{id},data}));
  }
  if(!proof.chapaReference)throw new ChapaError(502,'EVIDENCE_MISMATCH','Payment confirmation is pending.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chapa-reference:${proof.chapaReference}`},0))`;
  if(await tx.chapaCheckout.findFirst({where:{chapaReference:proof.chapaReference,id:{not:id}}}))return ownChapaCheckout(await tx.chapaCheckout.update({where:{id},data:{status:'NEEDS_REVIEW',reason:'DUPLICATE_PROVIDER_REFERENCE',leaseUntil:null,nextCheckAt:after(60000)}}));
  const creditJournalId=await creditChapaPayment(tx,order,proof.chapaReference,proof.hash);
  let receipt:BidReceipt|null=null,reason:string|null=null;
  if(order.purpose==='BID'){
   await tx.$executeRawUnsafe('SAVEPOINT chapa_bid');
   try{
    if(await tx.operation.findUnique({where:{userId_scope_key:{userId:order.userId,scope:'BID',key:order.key}}}))throw new ChapaError(409,'BID_ALREADY_ACCEPTED','The bid was already accepted.');
    if(order.batchId){
     const batch=await tx.bidBatchOrder.findUniqueOrThrow({where:{id:order.batchId}});
     const locksHeld=batch.auctionId===snapshot.auctionId&&batch.auctionSlug===order.auctionSlug&&batch.userId===snapshot.userId;
     receipt=await measureChapa('fulfill',()=>fulfillBatchInTransaction(tx,batch,{locksHeld}));
    }else receipt=await submitBidInTransaction(tx,{userId:order.userId,auctionSlug:order.auctionSlug!,amount:order.bidNumber!.toString(),feeVersion:order.feeVersion!,key:order.key,...(order.couponId?{couponId:order.couponId}:{})},process.env,{allowDepositBonus:false});
    if(new Prisma.Decimal(receipt.charge.netFeePoints??receipt.charge.feePoints).mul(100).toString()!==order.amountCents.toString())throw new ChapaError(409,'FEE_CHANGED','The discount or fee changed.');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT chapa_bid');
   }catch(error){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT chapa_bid');await tx.$executeRawUnsafe('RELEASE SAVEPOINT chapa_bid');receipt=null;reason=error instanceof BidError||error instanceof ChapaError?error.code:'PAID_BID_NOT_ACCEPTED'}
  }
  const updated=await tx.chapaCheckout.update({where:{id},data:{...verifiedFields(order),creditJournalId,status:receipt?'BID_ACCEPTED':order.purpose==='TOP_UP'?'CREDITED':'NEEDS_REVIEW',reason,...(receipt?{bidId:receipt.bid.id,receipt:json(receipt)}:{})}});
  if(!receipt){
   const alert=await tx.outbox.create({data:{key:`chapa:${id}:credited`,kind:'DEPOSIT_CREDITED',payload:{checkoutId:id,recipientUserId:order.userId}}});
   await materializeAlert(tx,alert);
  }
  return ownChapaCheckout(updated);
 },PAYMENT_TRANSACTION_OPTIONS)));
}
export async function recoverChapaCheckouts(client:PrismaClient,limit=20,transport:ChapaTransport=chapaTransport){
 const health=chapaAvailability(),legacy=chapaLegacyRecoveryAvailability(),versions:Prisma.ChapaCheckoutWhereInput[]=[];
 if(health.recoveryEnabled&&process.env.CHAPA_LEGACY_SWEEP_ENABLED==='true'){
  const authorizedIds=chapaRecoveryBindings().map(binding=>binding.checkoutId);
  versions.push({flowVersion:1,mode:health.mode,createdAt:{gte:new Date(Date.now()-30*86400000)},OR:[{credentialFingerprint:health.credentialFingerprint!},...(authorizedIds.length?[{id:{in:authorizedIds}}]:[])]});
 }
 if(legacy.recoveryEnabled){
  const authorizedIds=legacyChapaRecoveryBindings().map(binding=>binding.checkoutId);
  versions.push({flowVersion:3,mode:legacy.mode,OR:[{credentialFingerprint:legacy.credentialFingerprint!},...(authorizedIds.length?[{id:{in:authorizedIds}}]:[])]});
 }
 if(!versions.length)return {checked:0};
 const rows=await client.chapaCheckout.findMany({where:{creditJournalId:null,AND:[{OR:versions},{OR:[{status:{in:openStatuses}},{reason:'PROVIDER_EVENT_RECEIVED'},{verificationSignalVersion:{gt:client.chapaCheckout.fields.verificationHandledSignalVersion}}]}],nextCheckAt:{lte:new Date()}},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit))});
 let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id,undefined,undefined,transport);checked++}catch{/* Durable intent and lease remain recoverable; no raw provider/contact logging. */}}return {checked};
}
