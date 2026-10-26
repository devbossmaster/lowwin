import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type ArifPayCheckout,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {BidError,submitBidInTransaction} from '../auctions/bids';
import {isSubmissionFeeOnly} from '../auctions/rules';
import {auctionMaintenance} from '../auctions/maintenance';
import {createsFourConsecutiveAmounts,parseBidCents} from '../auctions/consecutive-bids';
import {assertPlayerContact,contactBotId,decryptPhone,encryptPhone,normalizePhone,phoneHash} from '../auth/own-contact';
import {ensureWallet,pointsSchema,seedPlatformAccounts} from '../wallet/ledger';
import {PAYMENT_TRANSACTION_OPTIONS} from './timing';
import {ArifPayError,arifPayCanaryAllowed,arifPayHash,arifPayTransport,createdArifPaySession,parseArifPayEvidence,requireArifPay,type ArifPayTransport} from './arifpay-provider';

type Tx=Prisma.TransactionClient;
type Authorize=(tx:Tx)=>Promise<void>;
const createSchema=z.object({auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),amount:pointsSchema,feeVersion:z.number().int().min(1),key:z.string().uuid(),channel:z.enum(['TELEBIRR','MPESA']),phone:z.string().max(32)}).strict();
const finalStatuses=['BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED'];
const pendingStatuses=['SUBMITTING','PENDING'];
function resolvedCheckout(t:ArifPayCheckout){return finalStatuses.includes(t.status)&&!(t.status==='NEEDS_REVIEW'&&!t.creditJournalId&&t.reason==='PROVIDER_CONFIRMATION_REQUIRED')}
export function ownArifPayCheckout(t:ArifPayCheckout){
 const receipt=t.receipt&&typeof t.receipt==='object'&&!Array.isArray(t.receipt)?Object.fromEntries(Object.entries(t.receipt).filter(([key])=>key!=='wallet')):t.receipt;
 return {id:t.id,auctionSlug:t.auctionSlug,amount:t.bidNumber.toString(),feeVersion:t.feeVersion,fee:t.fee.toString(),currency:t.currency,channel:t.channel,status:t.status,reason:t.reason,receipt,createdAt:t.createdAt.toISOString(),expiresAt:t.expiresAt.toISOString(),pollAfterMs:Math.max(2000,t.nextCheckAt.getTime()-Date.now()),fundsPreserved:!!t.creditJournalId&&t.status==='NEEDS_REVIEW'};}
export type ArifPayCheckoutView=ReturnType<typeof ownArifPayCheckout>;
async function eligible(tx:Tx,userId:string){
 try{await assertPlayerContact(tx,userId)}catch{throw new ArifPayError(403,'CONTACT_REQUIRED','Share your own contact in Telegram first.')}
 if(await tx.staffMember.findUnique({where:{userId}})||await tx.userRestriction.findFirst({where:{userId,suspended:true}}))throw new ArifPayError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.');
}
export async function createArifPayCheckout(client:PrismaClient,userId:string,input:unknown,reauthorize?:Authorize,transport:ArifPayTransport=arifPayTransport){
 requireArifPay();
 const body=createSchema.parse(input),phone=normalizePhone(body.phone).replace(/^\+/, '');
 if(!arifPayCanaryAllowed(userId,body.auctionSlug))throw new ArifPayError(503,'PAYMENT_UNAVAILABLE','Direct payment is not available for this account or auction yet.');
 if(!(body.channel==='MPESA'?/^2517\d{8}$/:/^2519\d{8}$/).test(phone))throw new ArifPayError(422,'INVALID_PHONE',body.channel==='MPESA'?'Enter an M-PESA number starting with 07 or 2517.':'Enter a Telebirr number starting with 09 or 2519.');
 const requestHash=arifPayHash(JSON.stringify({...body,amount:body.amount.toString(),phone:phoneHash(`+${phone}`)}));
 const started=await client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))throw new ArifPayError(503,'AUCTIONS_PAUSED','New checkouts are paused for auction maintenance. Existing verification continues.');
  // Match the existing bid/settlement writer order: auction -> wallet -> order.
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE slug=${body.auctionSlug} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
  if(reauthorize)await reauthorize(tx);await eligible(tx,userId);
  const prior=await tx.arifPayCheckout.findUnique({where:{userId_key:{userId,key:body.key}}});
  if(prior){if(prior.requestHash!==requestHash)throw new ArifPayError(409,'KEY_REUSED','Retry this payment with the original details.');return {order:prior,created:false}}
  const active=await tx.arifPayCheckout.findFirst({where:{userId,auctionSlug:body.auctionSlug,bidNumber:body.amount,status:{notIn:['FAILED','CANCELLED','EXPIRED']}}});
  if(active)return {order:active,created:false};
  if(await tx.operation.findUnique({where:{userId_scope_key:{userId,scope:'BID',key:body.key}}}))throw new ArifPayError(409,'KEY_REUSED','This bid was already processed. Check My Bids.');
  const a=await tx.auction.findUnique({where:{slug:body.auctionSlug},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},product:{include:{category:true}},category:true}});
  const now=(await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;
  if(!a||!a.publishedAt||a.publishedAt>now||!a.startsAt||a.startsAt>now||!a.endsAt||a.endsAt.getTime()-now.getTime()<30000||!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.product.category.visible||!a.category?.visible)throw new ArifPayError(409,'AUCTION_CLOSED','This auction is closed or too close to its deadline to start a new payment.');
  if(a.isDemo||!a.terms||!isSubmissionFeeOnly(a.terms.ruleVersion))throw new ArifPayError(409,'LEGACY_TERMS','Direct checkout is available for submission-fee auctions only. Older auction terms are preserved.');
  const terms=a.terms,fee=a.feeRevisions[0];
  if(!fee||fee.version!==body.feeVersion||fee.feePoints.lte(0)||fee.feePoints.gt(43200))throw new ArifPayError(409,'TERMS_CHANGED','Review the latest submission fee before paying.');
  if(body.amount.lt(1)||body.amount.lt(terms.minPoints)||terms.maxPoints!==null&&body.amount.gt(terms.maxPoints)||!body.amount.sub(terms.minPoints).mod(terms.stepPoints).isZero())throw new ArifPayError(422,'INVALID_AMOUNT','Choose a number within this auction’s published terms.');
  const bids=await tx.bid.findMany({where:{userId,auctionId:a.id},select:{amount:true}});
  if(bids.some(b=>b.amount.eq(body.amount)))throw new ArifPayError(409,'OWN_DUPLICATE','You already submitted this bid number.');
  if(bids.length>=terms.maxDistinctBids)throw new ArifPayError(409,'CAP_REACHED','You reached this auction’s bid limit.');
  if(createsFourConsecutiveAmounts(bids.map(b=>parseBidCents(b.amount.toString())),parseBidCents(body.amount.toString())))throw new ArifPayError(422,'CONSECUTIVE_LIMIT','Leave a gap after three consecutive numbers.');
  if(await tx.arifPayCheckout.count({where:{userId,createdAt:{gte:new Date(now.getTime()-3600000)}}})>=12)throw new ArifPayError(429,'RATE_LIMITED','Too many payment attempts. Wait before starting another.');
  const order=await tx.arifPayCheckout.create({data:{userId,auctionId:a.id,auctionSlug:body.auctionSlug,key:body.key,requestHash,bidNumber:body.amount,feeVersion:fee.version,fee:fee.feePoints,channel:body.channel,phoneCipher:encryptPhone(`+${phone}`),phoneHash:phoneHash(`+${phone}`),nonce:`lowin_${randomBytes(24).toString('hex')}`,expiresAt:new Date(Math.min(a.endsAt.getTime(),now.getTime()+5*60000)),nextCheckAt:new Date(now.getTime()+15000)}});
  return {order,created:true};
 },PAYMENT_TRANSACTION_OPTIONS);
 if(!started.created)return ownArifPayCheckout(started.order);
 const t=started.order;
 const returnUrl=new URL(`/auctions/${t.auctionSlug}`,process.env.BETTER_AUTH_URL);returnUrl.searchParams.set('checkout',t.id);
 const notifyUrl=new URL('/api/payments/arifpay/webhook',process.env.BETTER_AUTH_URL);notifyUrl.searchParams.set('token',process.env.ARIFPAY_WEBHOOK_TOKEN!);
 try{
  const raw=await transport.create({nonce:t.nonce,phone,fee:t.fee.toString(),channel:body.channel,expiresAt:t.expiresAt,returnUrl:returnUrl.toString(),notifyUrl:notifyUrl.toString()});
  const sessionId=createdArifPaySession(raw);
  // Even SUCCESS in create/direct is not proof. Only merchant-key lookup can confirm.
  await client.arifPayCheckout.updateMany({where:{id:t.id,status:'SUBMITTING',sessionId:null},data:{...(sessionId?{sessionId}:{}),status:'PENDING',reason:sessionId?'AWAITING_PROVIDER':'VERIFYING',nextCheckAt:new Date(Date.now()+2000)}});
 }catch{
  // A timeout may have charged the customer. Never create a replacement session.
  await client.arifPayCheckout.updateMany({where:{id:t.id,status:'SUBMITTING'},data:{status:'PENDING',reason:'VERIFYING',nextCheckAt:new Date(Date.now()+2000)}});
 }
 return ownArifPayCheckout(await client.arifPayCheckout.findUniqueOrThrow({where:{id:t.id}}));
}
export async function getArifPayCheckout(client:PrismaClient,userId:string,id:string){
 const order=await client.arifPayCheckout.findFirst({where:{id,userId}});if(!order)throw new ArifPayError(404,'NOT_FOUND','Payment not found.');return ownArifPayCheckout(order);
}
export async function listArifPayCheckouts(client:PrismaClient,userId:string){
 // Before the additive migration this feature has never accepted payments.
 if(process.env.ARIFPAY_SCHEMA_READY!=='true')return {items:[]};
 return {items:(await client.arifPayCheckout.findMany({where:{userId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20})).map(ownArifPayCheckout)};
}
export async function verifyArifPayCheckout(client:PrismaClient,id:string,userId?:string,reauthorize?:Authorize,transport:ArifPayTransport=arifPayTransport){
 requireArifPay('recover');
 const snapshot=await client.arifPayCheckout.findFirst({where:{id,...(userId?{userId}:{})}});if(!snapshot)throw new ArifPayError(404,'NOT_FOUND','Payment not found.');
 if(resolvedCheckout(snapshot))return ownArifPayCheckout(snapshot);
 // Short durable lease avoids duplicate provider fetches across tabs, callback and worker.
 const recoverable={OR:[{status:{in:pendingStatuses}},{status:'NEEDS_REVIEW',creditJournalId:null,reason:'PROVIDER_CONFIRMATION_REQUIRED'}]};
 const lease=await client.$transaction(async tx=>{if(reauthorize)await reauthorize(tx);return tx.arifPayCheckout.updateMany({where:{id,...recoverable,nextCheckAt:{lte:new Date()}},data:{nextCheckAt:new Date(Date.now()+15000),attempts:{increment:1}}})},PAYMENT_TRANSACTION_OPTIONS);
 if(!lease.count)return ownArifPayCheckout(await client.arifPayCheckout.findUniqueOrThrow({where:{id}}));
 const needsProviderReview=()=>snapshot.expiresAt.getTime()<=Date.now();
 let raw:unknown;try{raw=await transport.lookup(snapshot.nonce)}catch{
  if(needsProviderReview())await client.arifPayCheckout.updateMany({where:{id,...recoverable},data:{status:'NEEDS_REVIEW',reason:'PROVIDER_CONFIRMATION_REQUIRED',nextCheckAt:new Date(Date.now()+60000)}});
  return ownArifPayCheckout(await client.arifPayCheckout.findUniqueOrThrow({where:{id}}));
 }
 const evidence=parseArifPayEvidence(raw);
 const phone=decryptPhone(snapshot.phoneCipher,contactBotId()).replace(/^\+/,'');
 const matches=!!evidence&&evidence.nonce===snapshot.nonce&&evidence.phone===phone&&new Prisma.Decimal(evidence.amount).eq(snapshot.fee)
  &&(!snapshot.sessionId||evidence.sessionId===snapshot.sessionId)&&(!evidence.currency||evidence.currency==='ETB')
  &&(!evidence.channel||evidence.channel===(snapshot.channel==='MPESA'?'MPESA':'TELEBIRR_USSD')||snapshot.channel==='TELEBIRR'&&evidence.channel==='TELEBIRR');
 if(!matches){
  await client.arifPayCheckout.updateMany({where:{id,...recoverable},data:{...(needsProviderReview()?{status:'NEEDS_REVIEW',reason:'PROVIDER_CONFIRMATION_REQUIRED'}:{reason:'EVIDENCE_PENDING'}),evidenceHash:arifPayHash(JSON.stringify(raw)??'null'),nextCheckAt:new Date(Date.now()+60000)}});
  return getArifPayCheckout(client,snapshot.userId,id);
 }
 return client.$transaction(async tx=>{
  await auctionMaintenance(tx);
  if(reauthorize)await reauthorize(tx);
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${snapshot.auctionId} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${snapshot.userId}`},0))`;
  await tx.$queryRaw`SELECT id FROM "ArifPayCheckout" WHERE id=${id} FOR UPDATE`;
  const t=await tx.arifPayCheckout.findUniqueOrThrow({where:{id}});if(resolvedCheckout(t))return ownArifPayCheckout(t);
  if(evidence!.status!=='SUCCESS'){
   const review=evidence!.status==='PENDING'&&needsProviderReview();
   return ownArifPayCheckout(await tx.arifPayCheckout.update({where:{id},data:{sessionId:evidence!.sessionId,status:review?'NEEDS_REVIEW':evidence!.status==='PENDING'?'PENDING':evidence!.status,reason:review?'PROVIDER_CONFIRMATION_REQUIRED':evidence!.status==='PENDING'?'AWAITING_PROVIDER':'PAYMENT_NOT_COMPLETED',evidenceHash:evidence!.hash,nextCheckAt:new Date(Date.now()+(review?60000:5000))}}));
  }
  if(!evidence!.transactionId)return ownArifPayCheckout(await tx.arifPayCheckout.update({where:{id},data:{...(needsProviderReview()?{status:'NEEDS_REVIEW',reason:'PROVIDER_CONFIRMATION_REQUIRED'}:{reason:'EVIDENCE_PENDING'}),evidenceHash:evidence!.hash,nextCheckAt:new Date(Date.now()+60000)}}));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`arifpay-transfer:${evidence!.transactionId}`},0))`;
  const duplicate=await tx.arifPayCheckout.findFirst({where:{transactionId:evidence!.transactionId,id:{not:id}}});
  if(duplicate)return ownArifPayCheckout(await tx.arifPayCheckout.update({where:{id},data:{status:'NEEDS_REVIEW',reason:'DUPLICATE_PROVIDER_REFERENCE'}}));
  await ensureWallet(tx,t.userId);await seedPlatformAccounts(tx);
  const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${t.userId}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}});
  const operation=await tx.operation.create({data:{userId:t.userId,scope:'ARIFPAY_RECEIPT',key:t.id,requestHash:evidence!.hash,result:{checkoutId:t.id,currency:'ETB',amount:t.fee.toString(),transactionId:evidence!.transactionId}}});
  const journal=await tx.journal.create({data:{operationId:operation.id,kind:'ARIFPAY_RECEIPT',reference:`arifpay:${t.id}`,postings:{create:[{accountId:issuance.id,delta:t.fee.negated()},{accountId:available.id,delta:t.fee}]}}});
  // Existing bid command retains deadline, contact, frozen fee, limits and idempotency.
  // Savepoint preserves verified funds if the bid loses a deadline/terms race.
  let receipt:Prisma.InputJsonValue|undefined,bidId:string|undefined,reason='PAID_BID_NOT_ACCEPTED';
  const previouslyAccepted=await tx.operation.findUnique({where:{userId_scope_key:{userId:t.userId,scope:'BID',key:t.key}}});
  if(previouslyAccepted){reason='BID_ALREADY_ACCEPTED'}else{
   await tx.$executeRawUnsafe('SAVEPOINT arifpay_bid');
   try{
    const accepted=await submitBidInTransaction(tx,{userId:t.userId,auctionSlug:t.auctionSlug,amount:t.bidNumber.toString(),key:t.key,feeVersion:t.feeVersion});
    receipt=accepted;bidId=accepted.bid.id;
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT arifpay_bid');
   }catch(error){
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT arifpay_bid');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT arifpay_bid');
    reason=error instanceof BidError?error.code:'PAID_BID_NOT_ACCEPTED';
   }
  }
  return ownArifPayCheckout(await tx.arifPayCheckout.update({where:{id},data:{sessionId:evidence!.sessionId,transactionId:evidence!.transactionId,creditJournalId:journal.id,evidenceHash:evidence!.hash,status:bidId?'BID_ACCEPTED':'NEEDS_REVIEW',reason:bidId?null:reason,...(receipt?{receipt}:{}),...(bidId?{bidId}:{})}}));
 },PAYMENT_TRANSACTION_OPTIONS);
}
export async function recoverArifPayCheckouts(client:PrismaClient,limit=20){
 const due=await client.arifPayCheckout.findMany({where:{OR:[{status:{in:pendingStatuses}},{status:'NEEDS_REVIEW',creditJournalId:null,reason:'PROVIDER_CONFIRMATION_REQUIRED',expiresAt:{gte:new Date(Date.now()-86400000)}}],nextCheckAt:{lte:new Date()}},orderBy:{nextCheckAt:'asc'},take:Math.min(50,limit),select:{id:true}});
 let checked=0;for(const order of due){try{await verifyArifPayCheckout(client,order.id);checked++}catch{ /* Durable nextCheckAt allows retry. No private provider payload logging. */ }}return {checked};
}
