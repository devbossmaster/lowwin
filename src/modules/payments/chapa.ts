import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {assertPlayerContact,contactBotId} from '../auth/own-contact';
import {BidError,submitBidInTransaction,type BidReceipt} from '../auctions/bids';
import {auctionMaintenance} from '../auctions/maintenance';
import {isSubmissionFeeOnly} from '../auctions/rules';
import {createsFourConsecutiveAmounts,parseBidCents} from '../auctions/consecutive-bids';
import {lockReferralDiscountInTransaction} from '../referrals/service';
import {ensureWallet,pointsSchema,seedPlatformAccounts} from '../wallet/ledger';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {measureChapa} from './chapa-timing';
import {matchesChapaMetadata} from './chapa-metadata';
import {ChapaError,ChapaProviderError,chapaAvailability,chapaConfigurationFingerprint,chapaHash,chapaTransport,createdChapaSession,isChapaHostedSessionReference,parseChapaEvidence,requireChapa,type ChapaCreate,type ChapaTransport} from './chapa-provider';
import {approvedRecoveryBinding,chapaRecoveryBindings} from './chapa-recovery-binding';

type Tx=Prisma.TransactionClient;
type Authorize=(tx:Tx)=>Promise<void>;
const money=z.string().regex(/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
const createSchema=z.discriminatedUnion('purpose',[
 z.object({key:z.string().uuid(),purpose:z.literal('TOP_UP'),amount:money}).strict(),
 z.object({key:z.string().uuid(),purpose:z.literal('BID'),auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),amount:pointsSchema,feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional()}).strict(),
]);
const pending=['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED'];
const openStatuses=[...pending,'NEEDS_REVIEW'];
const aliasScope='CHAPA_CHECKOUT_ALIAS';
const aliasResult=z.object({checkoutId:z.string().uuid()}).strict();
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const paid=(order:ChapaCheckout)=>order.creditJournalId!==null;
const after=(ms:number)=>new Date(Date.now()+ms);

export function walletBidsEnabled(raw:Record<string,string|undefined>=process.env){
 if(raw.WALLET_BIDS_ENABLED!=='true'||raw.DEV_IDENTITY_ENABLED==='true'||raw.STAGING_DEMO_ENABLED==='true')return false;
 return raw.APP_ENV==='production'||raw.VERCEL_ENV==='production'?raw.NODE_ENV==='production'&&raw.WALLET_BIDS_LIVE_ENABLED==='true'&&raw.DEV_POINTS_ENABLED!=='true':['local','test','staging'].includes(raw.APP_ENV??'');
}
export function publicChapaAvailability(){const value=chapaAvailability();return {enabled:value.enabled,configured:value.configured,mode:value.mode,walletBidsEnabled:walletBidsEnabled(),minTopup:'1.00',maxTopup:'43200.00',reason:value.reason}}
const context={auction:{select:{publicCode:true,status:true,endsAt:true,product:{select:{title:true,titleAm:true}}}}} satisfies Prisma.ChapaCheckoutInclude;
type OrderContext={auction?:{publicCode:number;status:string;endsAt:Date|null;product:{title:string;titleAm:string|null}|null}|null};
export function ownChapaCheckout(order:ChapaCheckout&OrderContext){
 return {id:order.id,purpose:order.purpose,mode:order.mode,amount:centsToEtb(order.amountCents),amountCents:order.amountCents.toString(),currency:order.currency,status:order.status,reason:order.reason,providerStatus:order.providerStatus??(paid(order)?'SUCCESS':null),verificationState:order.verificationState,initializationErrorCode:order.initializationErrorCode,initializationHttpStatus:order.initializationHttpStatus,merchantReference:order.merchantReference,paymentMethod:order.paymentMethod,auctionTitle:order.auction?.product?.title??null,auctionTitleAm:order.auction?.product?.titleAm??null,auctionCode:order.auction?.publicCode?.toString()??null,auctionStatus:order.auction?.status??null,auctionEndsAt:order.auction?.endsAt?.toISOString()??null,checkoutUrl:order.checkoutUrl,auctionSlug:order.auctionSlug,bidNumber:order.bidNumber?.toString()??null,feeVersion:order.feeVersion,grossFee:order.grossFee?.toString()??null,discountPoints:order.discountPoints.toString(),createdAt:order.createdAt.toISOString(),expiresAt:order.expiresAt.toISOString(),pollAfterMs:Math.max(5000,order.nextCheckAt.getTime()-Date.now()),fundsPreserved:paid(order)&&order.status==='NEEDS_REVIEW',receipt:order.receipt};
}
async function eligible(tx:Tx,userId:string){
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
function sameConfiguration(order:ChapaCheckout){const value=chapaAvailability();return value.mode===order.mode&&chapaConfigurationFingerprint()===order.credentialFingerprint}

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
   if(createsFourConsecutiveAmounts(own.map(b=>parseBidCents(b.amount.toString())),parseBidCents(body.amount.toString())))throw new ChapaError(422,'CONSECUTIVE_LIMIT','Leave a gap after three consecutive numbers.');
   grossFee=fee.feePoints;
   if(body.couponId)discountPoints=(await lockReferralDiscountInTransaction(tx,userId,body.couponId,grossFee,terms.ruleVersion)).discountPoints;
   amountCents=etbToCents(grossFee.sub(discountPoints).toString());
   if(amountCents<100n||amountCents>4320000n)throw new ChapaError(422,'CHAPA_MINIMUM','This fee is below Chapa’s 1.00 ETB minimum or above its configured limit. Use your wallet for this submission fee.');
   auctionId=a.id;bidNumber=body.amount;
  }
  const id=randomUUID(),merchantReference=`LW${randomBytes(9).toString('hex')}`;
  const initialization:ChapaCreate={amountCents:amountCents.toString(),merchantReference,idempotencyKey:`lowwin:${id}`};
  return tx.chapaCheckout.create({data:{id,userId,purpose:body.purpose,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,key:body.key,requestHash,merchantReference,amountCents,initialization:json(initialization),phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,auctionId,auctionSlug:body.purpose==='BID'?body.auctionSlug:null,bidNumber,grossFee,discountPoints,feeVersion:body.purpose==='BID'?body.feeVersion:null,couponId:body.purpose==='BID'?body.couponId:null,expiresAt:after(86400000)}});
 },PAYMENT_TRANSACTION_OPTIONS));
 if(!paid(order)&&!order.checkoutUrl&&sameConfiguration(order)){const initialized=await initializeChapaCheckout(client,order.id,transport,order);if(initialized)return ownChapaCheckout(initialized);return getChapaCheckout(client,userId,order.id)}
 return ownChapaCheckout(order);
}

async function initializeChapaCheckout(client:PrismaClient,id:string,transport:ChapaTransport,persisted?:ChapaCheckout){
 if(!chapaAvailability().enabled)return;
 const snapshot=persisted??await measureChapa('database',()=>client.chapaCheckout.findUniqueOrThrow({where:{id}}));if(paid(snapshot)||snapshot.checkoutUrl||!sameConfiguration(snapshot)||!['SUBMITTING','PENDING'].includes(snapshot.status)||snapshot.reason&&!['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_EVENT_RECEIVED'].includes(snapshot.reason))return;
 const initializationState={id,creditJournalId:null,checkoutUrl:null,status:{in:['SUBMITTING','PENDING']},OR:[{reason:null},{reason:{in:['INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_EVENT_RECEIVED']}}]};
 // Take the barrier first, then use a fresh statement snapshot for the halt
 // check and lease update. A single CTE could miss a halt committed while it
 // waited for that barrier. Provider HTTP stays outside this transaction.
 const acquired=await measureChapa('database',()=>client.$transaction(async tx=>{
 await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
 return tx.$executeRaw`UPDATE "ChapaCheckout" c SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '20 seconds',"nextCheckAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '20 seconds',"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
 WHERE c.id=${id} AND c."creditJournalId" IS NULL AND c."checkoutUrl" IS NULL AND c.status IN ('SUBMITTING','PENDING')
 AND (c.reason IS NULL OR c.reason IN ('INITIALIZATION_PENDING','PROVIDER_CONFIRMATION_REQUIRED','PROVIDER_EVENT_RECEIVED'))
 AND (c."leaseUntil" IS NULL OR c."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
 AND COALESCE((SELECT action<>'AUCTIONS_MAINTENANCE_HALTED' FROM "AdminAudit" WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1),true)`;
 },PAYMENT_TRANSACTION_OPTIONS));
 if(!acquired)return;
 try{
  const response=createdChapaSession(await measureChapa('initialize',()=>transport.create(initializationInput(snapshot))));
  if(!response)throw new Error('Invalid initialization evidence');
  const rows=await measureChapa('database',()=>client.chapaCheckout.updateManyAndReturn({where:initializationState,data:{checkoutUrl:response.checkoutUrl,chapaReference:response.chapaReference,...(response.createdAt?{providerCreatedAt:response.createdAt}:{}),...(response.expiresAt?{expiresAt:response.expiresAt}:{}),status:'PENDING',reason:'AWAITING_PROVIDER',leaseUntil:null,nextCheckAt:after(5000)}}));return rows[0];
 }catch(error){
  const rejected=error instanceof ChapaProviderError&&error.definiteRejection;
  const rows=await measureChapa('database',()=>client.chapaCheckout.updateManyAndReturn({where:initializationState,data:{status:rejected?'NEEDS_REVIEW':'PENDING',reason:rejected?'INITIALIZATION_REJECTED':'INITIALIZATION_PENDING',initializationErrorCode:error instanceof ChapaProviderError?error.providerCode:null,initializationHttpStatus:error instanceof ChapaProviderError?error.httpStatus:null,leaseUntil:null,nextCheckAt:after(15000)}}));return rows[0];
 }
}
export async function getChapaCheckout(client:PrismaClient,userId:string,id:string){
 const order=await measureChapa('database',()=>client.chapaCheckout.findFirst({where:{id:z.string().uuid().parse(id),userId},include:context}));if(!order)throw new ChapaError(404,'NOT_FOUND','Payment not found.');return ownChapaCheckout(order);
}
export async function listChapaCheckouts(client:PrismaClient,userId:string,purpose?:'TOP_UP'|'BID',page=1,unaccepted=false){
 const filter=z.enum(['TOP_UP','BID']).optional().parse(purpose);page=z.number().int().min(1).max(10000).parse(page);
 if(process.env.CHAPA_SCHEMA_READY!=='true')return {items:[],page,nextPage:null};
 const rows=await client.chapaCheckout.findMany({where:{userId,...(filter?{purpose:filter}:{}),...(unaccepted?{purpose:'BID',bidId:null}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*20,take:21,include:context});
 return {items:rows.slice(0,20).map(ownChapaCheckout),page,nextPage:rows.length>20?page+1:null};
}
export async function verifyChapaCheckout(client:PrismaClient,id:string,userId?:string,reauthorize?:Authorize,transport:ChapaTransport=chapaTransport,eventCheck=false){
 requireChapa('recover');z.string().uuid().parse(id);
 const snapshot=await measureChapa('database',()=>client.chapaCheckout.findFirst({where:{id,...(userId?{userId}:{})}}));if(!snapshot)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
 if(paid(snapshot))return ownChapaCheckout(snapshot);
 const recoveryBinding=sameConfiguration(snapshot)?null:await approvedRecoveryBinding(client,snapshot);
 if(!sameConfiguration(snapshot)&&!recoveryBinding)throw new ChapaError(503,'CONFIGURATION_CHANGED','This payment needs its original Chapa configuration or a reviewed recovery authorization. Keep its payment ID.');
 const acquired=await measureChapa('database',()=>client.$transaction(async tx=>{if(reauthorize)await reauthorize(tx);return tx.chapaCheckout.updateMany({where:{id,creditJournalId:null,...(eventCheck?{}:{nextCheckAt:{lte:new Date()}}),OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},data:{leaseUntil:after(20000),nextCheckAt:after(20000),attempts:{increment:1}}})},PAYMENT_TRANSACTION_OPTIONS));
 if(!acquired.count)return ownChapaCheckout(await measureChapa('database',()=>client.chapaCheckout.findUniqueOrThrow({where:{id}})));
 let raw:unknown;try{raw=await measureChapa('verify',()=>transport.lookup(snapshot.merchantReference))}catch{
  await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{id,creditJournalId:null},data:{leaseUntil:null,nextCheckAt:after(30000),reason:'PROVIDER_CONFIRMATION_REQUIRED',verificationState:'UNAVAILABLE'}}));return getChapaCheckout(client,snapshot.userId,id);
 }
 const evidence=parseChapaEvidence(raw),matches=!!evidence&&evidence.merchantReference===snapshot.merchantReference&&evidence.amountCents===snapshot.amountCents.toString()&&evidence.currency===snapshot.currency&&(!evidence.chapaReference||!snapshot.chapaReference||snapshot.chapaReference===evidence.chapaReference||isChapaHostedSessionReference(snapshot.checkoutUrl,snapshot.chapaReference,snapshot.mode as 'test'|'live'))&&(!evidence.mode||evidence.mode===snapshot.mode)&&(!recoveryBinding||evidence.status==='SUCCESS'&&evidence.chapaReference===recoveryBinding.finalReference)&&matchesChapaMetadata(snapshot.initialization,evidence.meta,snapshot.id);
 if(!matches){await measureChapa('database',()=>client.chapaCheckout.updateMany({where:{id,creditJournalId:null},data:{status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH',verificationState:'MISMATCH',leaseUntil:null,nextCheckAt:after(60000)}}));return getChapaCheckout(client,snapshot.userId,id)}
 return measureChapa('database',()=>client.$transaction(async tx=>{
  await auctionMaintenance(tx);if(snapshot.auctionId)await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${snapshot.auctionId} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${snapshot.userId}`},0))`;
  const [order]=await tx.$queryRaw<ChapaCheckout[]>`SELECT * FROM "ChapaCheckout" WHERE id=${id} FOR UPDATE`;
  if(!order)throw new ChapaError(404,'NOT_FOUND','Payment not found.');
  if(reauthorize)await reauthorize(tx);
  if(paid(order))return ownChapaCheckout(order);
  const lockedBinding=sameConfiguration(order)?null:await approvedRecoveryBinding(tx,order);
  if(!sameConfiguration(order)&&(!lockedBinding||lockedBinding.finalReference!==evidence!.chapaReference))throw new ChapaError(503,'CONFIGURATION_CHANGED','Payment verification configuration changed. Keep this payment ID.');
  const proof=evidence!,fields={chapaReference:proof.chapaReference??order.chapaReference,paymentMethod:proof.paymentMethod??null,processorReference:proof.processorReference??null,serviceFeeCents:proof.serviceFeeCents===undefined?null:BigInt(proof.serviceFeeCents),evidenceHash:proof.hash,providerStatus:proof.status,verificationState:'VERIFIED',leaseUntil:null};
  if(proof.status!=='SUCCESS')return ownChapaCheckout(await tx.chapaCheckout.update({where:{id},data:{...fields,status:proof.status,reason:'PAYMENT_NOT_COMPLETED',nextCheckAt:after(proof.status==='PENDING'||proof.status==='AUTH_NEEDED'?15000:300000)}}));
  if(!proof.chapaReference)throw new ChapaError(502,'EVIDENCE_MISMATCH','Payment confirmation is pending.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chapa-reference:${proof.chapaReference}`},0))`;
  if(await tx.chapaCheckout.findFirst({where:{chapaReference:proof.chapaReference,id:{not:id}}}))return ownChapaCheckout(await tx.chapaCheckout.update({where:{id},data:{status:'NEEDS_REVIEW',reason:'DUPLICATE_PROVIDER_REFERENCE',leaseUntil:null,nextCheckAt:after(60000)}}));
  await ensureWallet(tx,order.userId);await seedPlatformAccounts(tx);
  const amount=new Prisma.Decimal(centsToEtb(order.amountCents)),accounts=await tx.ledgerAccount.findMany({where:{name:{in:[`user:${order.userId}:available`,'platform:issuance']}},select:{id:true,name:true}}),available=accounts.find(account=>account.name===`user:${order.userId}:available`),issuance=accounts.find(account=>account.name==='platform:issuance');
  if(!available||!issuance)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','The payment accounts could not be loaded. Retry this same payment.');
  const operation=await tx.operation.create({data:{userId:order.userId,scope:'CHAPA_RECEIPT',key:order.id,requestHash:proof.hash,result:{checkoutId:id,merchantReference:order.merchantReference,chapaReference:proof.chapaReference,mode:order.mode,amountCents:order.amountCents.toString(),currency:'ETB'}}});
  const journal=await tx.journal.create({data:{operationId:operation.id,kind:'CHAPA_RECEIPT',reference:`chapa:${order.merchantReference}`,postings:{create:[{accountId:issuance.id,delta:amount.negated()},{accountId:available.id,delta:amount}]}}});
  let receipt:BidReceipt|null=null,reason:string|null=null;
  if(order.purpose==='BID'){
   await tx.$executeRawUnsafe('SAVEPOINT chapa_bid');
   try{
    if(await tx.operation.findUnique({where:{userId_scope_key:{userId:order.userId,scope:'BID',key:order.key}}}))throw new ChapaError(409,'BID_ALREADY_ACCEPTED','The bid was already accepted.');
    receipt=await submitBidInTransaction(tx,{userId:order.userId,auctionSlug:order.auctionSlug!,amount:order.bidNumber!.toString(),feeVersion:order.feeVersion!,key:order.key,...(order.couponId?{couponId:order.couponId}:{})});
    if(new Prisma.Decimal(receipt.charge.netFeePoints??receipt.charge.feePoints).mul(100).toString()!==order.amountCents.toString())throw new ChapaError(409,'FEE_CHANGED','The discount or fee changed.');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT chapa_bid');
   }catch(error){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT chapa_bid');await tx.$executeRawUnsafe('RELEASE SAVEPOINT chapa_bid');receipt=null;reason=error instanceof BidError||error instanceof ChapaError?error.code:'PAID_BID_NOT_ACCEPTED'}
  }
  if(!receipt)await tx.notificationInbox.create({data:{key:`chapa:${id}:credited`,kind:'PAYMENT_CREDITED',userId:order.userId,title:'Wallet credited · ገንዘብ ገብቷል',body:`${amount.toFixed(2)} ETB verified through Chapa.${order.purpose==='BID'?' The bid was not accepted; the funds remain in your wallet.':''}\n${amount.toFixed(2)} ብር በChapa ተረጋግጦ ገብቷል።${order.purpose==='BID'?' ጨረታው አልተቀበለም፤ ገንዘቡ በዋሌትዎ ውስጥ ቀርቷል።':''}`,href:`/payments/chapa/return?checkout=${id}`}});
  return ownChapaCheckout(await tx.chapaCheckout.update({where:{id},data:{...fields,creditJournalId:journal.id,status:receipt?'BID_ACCEPTED':order.purpose==='TOP_UP'?'CREDITED':'NEEDS_REVIEW',reason,...(receipt?{bidId:receipt.bid.id,receipt:json(receipt)}:{})}}));
 },PAYMENT_TRANSACTION_OPTIONS));
}
export async function recoverChapaCheckouts(client:PrismaClient,limit=20,transport:ChapaTransport=chapaTransport){
 const health=chapaAvailability();if(!health.recoveryEnabled||process.env.CHAPA_LEGACY_SWEEP_ENABLED!=='true')return {checked:0};
 const authorizedIds=chapaRecoveryBindings().map(binding=>binding.checkoutId);
 const rows=await client.chapaCheckout.findMany({where:{flowVersion:1,mode:health.mode,creditJournalId:null,AND:[{OR:[{credentialFingerprint:health.credentialFingerprint!},...(authorizedIds.length?[{id:{in:authorizedIds}}]:[])]},{OR:[{status:{in:openStatuses}},{reason:'PROVIDER_EVENT_RECEIVED'}]}],createdAt:{gte:new Date(Date.now()-30*86400000)},nextCheckAt:{lte:new Date()}},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(20,limit))});
 let checked=0;for(const row of rows){try{await verifyChapaCheckout(client,row.id,undefined,undefined,transport);checked++}catch{/* Durable intent and lease remain recoverable; no raw provider/contact logging. */}}return {checked};
}
