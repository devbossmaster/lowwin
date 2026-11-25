import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type Auction,type BidBatchOrder,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {assertPlayerContact,contactBotId} from '../auth/own-contact';
import {lockReferralDiscountInTransaction} from '../referrals/service';
import {ChapaError,chapaHash} from '../payments/chapa-provider';
import {PAYMENT_TRANSACTION_OPTIONS} from '../payments/timing';
import {BidError,recordValidatedSubmissionFeeBidInTransaction,type BidReceipt} from './bids';
import {parseBidCents} from './consecutive-bids';
import {auctionMaintenance,lockAuctionMaintenance,readAuctionMaintenance} from './maintenance';
import {isSubmissionFeeOnly} from './rules';
import {walletBidsEnabled} from '../wallet/policy';
import {readWalletProjection} from '../wallet/balance';
import {measureChapa} from '../payments/chapa-timing';
import {consumeDepositBonusInTransaction,readDepositBonusFunds} from '../wallet/deposit-bonus';
import {bidPurchaseNotificationCopy} from '../notifications/amharic-copy';
import {materializeAlert} from '../notifications/service';
import type {PaymentSessionAuthorizer as Authorize} from '../payments/session';

type Tx=Prisma.TransactionClient;
const command=z.object({key:z.string().uuid(),auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),numbers:z.array(z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)).min(1).max(100),feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional()}).strict();
const lineSchema=z.object({position:z.number().int().nonnegative(),number:z.string(),grossFee:z.string(),discount:z.string(),netFee:z.string(),couponId:z.string().uuid().optional()}).strict();
export type BatchLine=z.infer<typeof lineSchema>;
export function rejectRetiredCoupon(couponId?:string|null){
 if(couponId)throw new ChapaError(409,'COUPON_UNAVAILABLE','Coupons have ended. Review a new quote before paying.');
}
export function normalizeBatchNumbers(numbers:string[]){
 const normalized=numbers.map(number=>centsToEtb(parseBidCents(number)));
 if(new Set(normalized).size!==normalized.length)throw new ChapaError(422,'OWN_DUPLICATE','Each bid amount must be different.');
 return normalized;
}
export function batchChildKey(batchId:string,position:number){const h=createHash('sha256').update(`lowwin:batch:${batchId}:${position}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export function batchLines(batch:Pick<BidBatchOrder,'lines'>){return z.array(lineSchema).min(1).max(100).parse(batch.lines)}
export function ownBatch(batch:BidBatchOrder){return {id:batch.id,quoteHash:batch.quoteHash,auctionSlug:batch.auctionSlug,ruleVersion:batch.ruleVersion,feeVersion:batch.feeVersion,lines:batchLines(batch),entryCount:batchLines(batch).length,total:centsToEtb(batch.totalCents),totalCents:String(batch.totalCents),grossTotal:centsToEtb(batch.grossCents),discountTotal:centsToEtb(batch.discountCents),status:batch.status}}
function publicBatchReceipt(receipts:BidReceipt[]){return receipts.map(({bid,charge})=>({bid,charge}))}
function walletBatchReceipt(batch:BidBatchOrder,receipt:BidReceipt&{receipts:BidReceipt[]},wallet:Awaited<ReturnType<typeof readWalletProjection>>){
 return {batch:ownBatch(batch),receipts:publicBatchReceipt(receipt.receipts),wallet:{...wallet,available:centsToEtb(etbToCents(wallet.available)),held:centsToEtb(etbToCents(wallet.held)),revision:wallet.revision},payment:{method:'wallet' as const,gateway:'INTERNAL_WALLET' as const,total:centsToEtb(batch.totalCents),acceptedBidIds:receipt.receipts.map(item=>item.bid.id)}};
}
async function lockBatchWriter(tx:Tx,userId:string,slug:string,allowReceiptReplay=false){
 const halted=await auctionMaintenance(tx);
 if(halted&&!allowReceiptReplay)throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
 // Consume the locked row before taking the wallet lock. The count also
 // preserves the wallet lock when the slug no longer exists for a replay.
 await tx.$executeRaw`
  WITH locked_auction AS MATERIALIZED (SELECT id FROM "Auction" WHERE slug=${slug} FOR UPDATE)
  SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))
  FROM (SELECT count(*) AS acquired FROM locked_auction) AS guard
  WHERE guard.acquired >= 0`;
 return halted;
}
/** One fresh snapshot retains contact ownership and every participation guard.
 * The existing tightly gated no-Telegram fixture exception remains delegated
 * to its original authorizer; ordinary Telegram members use one statement. */
export async function assertBatchEligibilityInTransaction(tx:Tx,userId:string){
 const [row]=await tx.$queryRaw<Array<{telegramId:string|null;role:string;contactTelegramId:string|null;botId:string|null;revokedAt:Date|null;staffId:string|null;suspended:boolean}>>`
  SELECT u."telegramId",u.role,c."telegramId" AS "contactTelegramId",c."botId",c."revokedAt",s."userId" AS "staffId",COALESCE(r.suspended,false) AS suspended
  FROM "user" u LEFT JOIN "TelegramOwnContact" c ON c."userId"=u.id
  LEFT JOIN "StaffMember" s ON s."userId"=u.id LEFT JOIN "UserRestriction" r ON r."userId"=u.id WHERE u.id=${userId}`;
 if(!row)throw Error('CONTACT_REQUIRED');
 if(!row.telegramId)await assertPlayerContact(tx,userId);
 else if(!row.contactTelegramId||row.revokedAt||row.contactTelegramId!==row.telegramId||row.botId!==contactBotId())throw Error('CONTACT_REQUIRED');
 if(row.role!=='member'||row.staffId||row.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.');
}
export async function validateBatchInTransaction(tx:Tx,userId:string,slug:string,numbers:string[],feeVersion:number,couponId?:string,locksHeld=false){
 if(!locksHeld)await measureChapa('locks',()=>lockBatchWriter(tx,userId,slug));
 await measureChapa('eligibility',()=>assertBatchEligibilityInTransaction(tx,userId));
 return priceBatchInTransaction(tx,userId,slug,numbers,feeVersion,couponId);
}
type BatchPriceRow=Pick<Auction,'id'|'code'|'slug'|'status'|'publishedAt'|'startsAt'|'endsAt'|'isDemo'|'testRunId'|'presentation'>&{
 productTitle:string|null;productTitleAm:string|null;productVisible:boolean|null;productDemo:boolean|null;
 productCategoryVisible:boolean|null;auctionCategoryVisible:boolean|null;
 ruleVersion:string|null;minPoints:Prisma.Decimal|null;maxPoints:Prisma.Decimal|null;stepPoints:Prisma.Decimal|null;maxDistinctBids:number|null;
 feeId:string|null;feeVersion:number|null;feePoints:Prisma.Decimal|null;
 now:Date;previousBids:{id:string;amount:string;acceptedAt:string}[];
};
export async function priceBatchInTransaction(tx:Tx,userId:string,slug:string,numbers:string[],feeVersion:number,couponId?:string){
 // The terms, fee, clock and owned bids use one fresh snapshot after any
 // caller-held locks. Transmit bid amounts as text to preserve decimal precision.
 const [row]=await tx.$queryRaw<BatchPriceRow[]>`
  SELECT a.id,a.code,a.slug,a.status,a."publishedAt",a."startsAt",a."endsAt",a."isDemo",a."testRunId",a.presentation,
   p.title AS "productTitle",p."titleAm" AS "productTitleAm",p.visible AS "productVisible",p."isDemo" AS "productDemo",
   pc.visible AS "productCategoryVisible",ac.visible AS "auctionCategoryVisible",
   t."ruleVersion",t."minPoints",t."maxPoints",t."stepPoints",t."maxDistinctBids",
   fee.id AS "feeId",fee.version AS "feeVersion",fee."feePoints",
   clock_timestamp() AT TIME ZONE 'UTC' AS now,owned."previousBids"
  FROM "Auction" a
  LEFT JOIN "Product" p ON p.id=a."productId"
  LEFT JOIN "Category" pc ON pc.id=p."categoryId"
  LEFT JOIN "Category" ac ON ac.id=a."categoryId"
  LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id
  LEFT JOIN LATERAL (
   SELECT f.id,f.version,f."feePoints" FROM "AuctionFeeRevision" f WHERE f."auctionId"=a.id
   ORDER BY f."effectiveAt" DESC,f.version DESC LIMIT 1
  ) fee ON true
  CROSS JOIN LATERAL (
   SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'amount',b.amount::text,'acceptedAt',b."acceptedAt" AT TIME ZONE 'UTC')
    ORDER BY b."acceptedAt",b.id),'[]'::jsonb) AS "previousBids"
   FROM "Bid" b WHERE b."userId"=${userId} AND b."auctionId"=a.id
  ) owned
  WHERE a.slug=${slug}`;
 if(!row?.publishedAt||row.publishedAt>row.now||!row.startsAt||row.startsAt>row.now||!row.endsAt||row.endsAt<=row.now||!['SCHEDULED','LIVE'].includes(row.status)||!row.productVisible||!row.productCategoryVisible||!row.auctionCategoryVisible)throw new ChapaError(409,'AUCTION_CLOSED','This auction is closed.');
 if(row.isDemo||row.testRunId||row.productDemo!==false||!row.ruleVersion||!isSubmissionFeeOnly(row.ruleVersion)||row.minPoints===null||row.stepPoints===null||row.maxDistinctBids===null)throw new ChapaError(409,'LEGACY_TERMS','This order supports real submission-fee auctions only.');
 if(!row.feeId||row.feeVersion!==feeVersion||row.feePoints===null)throw new ChapaError(409,'TERMS_CHANGED','The fee changed. Review a new quote before paying.');
 const terms={ruleVersion:row.ruleVersion,minPoints:row.minPoints,maxPoints:row.maxPoints,stepPoints:row.stepPoints,maxDistinctBids:row.maxDistinctBids};
 const fee={id:row.feeId,version:row.feeVersion,feePoints:row.feePoints};
 const auction={id:row.id,code:row.code,slug:row.slug,isDemo:row.isDemo,testRunId:row.testRunId,presentation:row.presentation,terms,feeRevisions:[fee],product:{title:row.productTitle,titleAm:row.productTitleAm,isDemo:row.productDemo}};
 const normalized=normalizeBatchNumbers(numbers),own=row.previousBids.map(bid=>({id:bid.id,amount:new Prisma.Decimal(bid.amount),acceptedAt:new Date(bid.acceptedAt)}));
 if(own.length+normalized.length>terms.maxDistinctBids)throw new ChapaError(409,'CAP_REACHED','These entries exceed your remaining submissions.');
 const seen=new Set(own.map(item=>String(parseBidCents(item.amount.toString()))));
 for(const number of normalized){const n=new Prisma.Decimal(number),cents=parseBidCents(number);if(n.lt(1)||n.lt(terms.minPoints)||terms.maxPoints!==null&&n.gt(terms.maxPoints)||!n.sub(terms.minPoints).mod(terms.stepPoints).isZero())throw new ChapaError(422,'INVALID_AMOUNT','Choose amounts within the published bounds and increment.');if(seen.has(String(cents)))throw new ChapaError(409,'OWN_DUPLICATE','You already submitted one of these amounts.');seen.add(String(cents))}
 const discount=couponId?await lockReferralDiscountInTransaction(tx,userId,couponId,fee.feePoints,terms.ruleVersion):null;
 const lines:BatchLine[]=normalized.map((number,position)=>{const saving=position===0&&discount?discount.discountPoints:new Prisma.Decimal(0);return {position,number,grossFee:fee.feePoints.toFixed(2),discount:saving.toFixed(2),netFee:fee.feePoints.sub(saving).toFixed(2),...(position===0&&couponId?{couponId}:{})}});
 const grossCents=etbToCents(fee.feePoints.toFixed(2))*BigInt(lines.length),discountCents=discount?etbToCents(discount.discountPoints.toFixed(2)):0n;
 if(grossCents>4320000n)throw new ChapaError(422,'INVALID_AMOUNT','Split this selection into smaller orders.');
 return {auction,own,discount,lines,totalCents:grossCents-discountCents,grossCents,discountCents};
}
export async function quoteBidBatch(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize){
 const input=command.parse(raw),numbers=normalizeBatchNumbers(input.numbers),requestHash=chapaHash(JSON.stringify({...input,numbers}));
 rejectRetiredCoupon(input.couponId);
 return client.$transaction(async tx=>{
  const check=reauthorize?.forBidBatchQuote;
  if(check)await measureChapa('locks',()=>lockAuctionMaintenance(tx));
  const fresh=check?await measureChapa('eligibility',()=>check(tx,userId,input.key)):null;
  const previous=fresh?.replayExists===false?null:await tx.bidBatchOrder.findUnique({where:{userId_key:{userId,key:input.key}}});
  if(previous){if(previous.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Changed selections require a new quote.');return ownBatch(previous)}
  if(!fresh&&reauthorize)await reauthorize(tx);
  // Keep the maintenance barrier while a simultaneous Pay acquires the
  // financial writer locks. Payment revalidates the price and bids there.
  if(fresh?fresh.maintenanceHalted:await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
  if(fresh)fresh.assertEligible();else await measureChapa('eligibility',()=>assertBatchEligibilityInTransaction(tx,userId));
  const priced=await measureChapa('pricing',()=>priceBatchInTransaction(tx,userId,input.auctionSlug,numbers,input.feeVersion));
  return ownBatch(await persistBidBatchQuoteInTransaction(tx,userId,input,priced,requestHash));
 },PAYMENT_TRANSACTION_OPTIONS);
}
/** Called after authoritative validation while the auction/wallet locks remain
 * held. Shared by quote-only and one-command direct checkout preparation. */
export async function persistBidBatchQuoteInTransaction(tx:Tx,userId:string,input:{key:string;auctionSlug:string;feeVersion:number;couponId?:string},priced:Awaited<ReturnType<typeof validateBatchInTransaction>>,requestHash:string){
 const id=randomUUID(),quoteHash=chapaHash(JSON.stringify({id,userId,ruleVersion:priced.auction.terms!.ruleVersion,feeVersion:input.feeVersion,lines:priced.lines,totalCents:String(priced.totalCents)}));
 return tx.bidBatchOrder.create({data:{id,userId,key:input.key,requestHash,quoteHash,auctionId:priced.auction.id,auctionSlug:input.auctionSlug,ruleVersion:priced.auction.terms!.ruleVersion,feeVersion:input.feeVersion,lines:priced.lines,totalCents:priced.totalCents,grossCents:priced.grossCents,discountCents:priced.discountCents,couponId:input.couponId}});
}
type FulfillBatchOptions={validated?:Awaited<ReturnType<typeof validateBatchInTransaction>>;allowDepositBonus?:boolean;locksHeld?:boolean;qualifyReferral?:boolean};
export async function fulfillBatchInTransaction(tx:Tx,batch:BidBatchOrder,{validated,allowDepositBonus=false,locksHeld=false,qualifyReferral=true}:FulfillBatchOptions={}){
 const prior=validated||locksHeld?batch:await tx.bidBatchOrder.findUniqueOrThrow({where:{id:batch.id}});
 if(prior.status==='ACCEPTED'&&prior.receipt)return prior.receipt as unknown as BidReceipt&{bids:BidReceipt['bid'][];receipts:BidReceipt[]};
 if(locksHeld&&!validated&&(await readAuctionMaintenance(tx)).halted)throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
 const lines=batchLines(batch),current=validated??await validateBatchInTransaction(tx,batch.userId,batch.auctionSlug,lines.map(item=>item.number),batch.feeVersion,batch.couponId??undefined,locksHeld);
 if(current.auction.terms!.ruleVersion!==batch.ruleVersion||current.totalCents!==batch.totalCents||JSON.stringify(current.lines)!==JSON.stringify(lines))throw new ChapaError(409,'TERMS_CHANGED','The quote or coupon changed. No bids were accepted.');
 // validateBatchInTransaction holds the shared wallet writer lock. Reject an
 // unaffordable complete order before creating even the first entry/outbox row.
 let useDepositBonus=allowDepositBonus;
 if(batch.totalCents>0n){
  const account=await tx.ledgerAccount.findUnique({where:{name:`user:${batch.userId}:available`},select:{balance:true}}),bonus=allowDepositBonus?await readDepositBonusFunds(tx,batch.userId):{bonusAvailable:'0'},available=etbToCents(account?.balance.toFixed(2)??'0')+etbToCents(bonus.bonusAvailable);
  if(available<batch.totalCents)throw new BidError('INSUFFICIENT_POINTS',409,'Your Lowwin Wallet balance is too low.',{available:centsToEtb(available),required:centsToEtb(batch.totalCents),shortfall:centsToEtb(batch.totalCents-available),currency:'ETB'});
  // The wallet writer lock makes the zero-bonus snapshot valid for this batch.
  // A positive balance still goes through normal expiry and consumption checks.
  useDepositBonus=allowDepositBonus&&etbToCents(bonus.bonusAvailable)>0n;
 }
 // Run the first entry through the existing authoritative command, including
 // coupon redemption and genuine first-bid referral qualification. Subsequent
 // entries share the same locked, fully validated batch and use bulk writes.
 // The database Bid triggers still stamp/check every acceptance individually;
 // any late/invalid line aborts the entire outer transaction/savepoint.
 const first=lines[0],initial=await recordValidatedSubmissionFeeBidInTransaction(tx,{userId:batch.userId,auctionSlug:batch.auctionSlug,amount:first.number,feeVersion:batch.feeVersion,key:batchChildKey(batch.id,0),...(first.couponId?{couponId:first.couponId}:{})},current,process.env,{allowDepositBonus:useDepositBonus,deferNotification:true,qualifyReferral}),receipts:BidReceipt[]=[initial];
 if(etbToCents(initial.charge.netFeePoints??initial.charge.feePoints)!==etbToCents(first.netFee))throw new ChapaError(409,'TERMS_CHANGED','The charged fee no longer matches this quote.');
 const rest=lines.slice(1),remainingCost=batch.totalCents-etbToCents(first.netFee);
 if(etbToCents(initial.wallet.available)<remainingCost)throw new BidError('INSUFFICIENT_POINTS',409,'Your Lowwin wallet does not have enough funds for the entire order.');
 if(rest.length){
  const fee=current.auction.feeRevisions[0],accounts=await tx.ledgerAccount.findMany({where:{name:{in:[`user:${batch.userId}:available`,'platform:fees']}},select:{id:true,name:true}}),available=accounts.find(account=>account.name===`user:${batch.userId}:available`),fees=accounts.find(account=>account.name==='platform:fees');
  if(!available||fee.feePoints.gt(0)&&!fees)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Payment accounts could not be loaded. Retry this same order.');
  const children=rest.map(line=>({line,id:randomUUID(),operationId:randomUUID(),journalId:randomUUID()}));
  const inserted=await tx.bid.createManyAndReturn({data:children.map(child=>({id:child.id,operationId:child.operationId,userId:batch.userId,auctionId:batch.auctionId,amount:new Prisma.Decimal(child.line.number),termsVersion:batch.feeVersion,feePoints:fee.feePoints,feeRevisionId:fee.id})),select:{id:true,amount:true,acceptedAt:true}}),byId=new Map(inserted.map(bid=>[bid.id,bid]));
  let availableCents=etbToCents(initial.wallet.available),cashCents=etbToCents(initial.wallet.cashAvailable??initial.wallet.available),bonusCents=etbToCents(initial.wallet.bonusAvailable??'0'),own=initial.ownBids;
  for(const child of children){const bid=byId.get(child.id)!,net=etbToCents(child.line.netFee),used=useDepositBonus?await consumeDepositBonusInTransaction(tx,{userId:batch.userId,bidId:bid.id,netFeeCents:net}):0n;availableCents-=net;cashCents-=net-used;if(cashCents<0n)throw new BidError('INSUFFICIENT_POINTS',409,'The bonus changed or expired. Review your current balance and retry.');bonusCents-=used;own=[...own,{id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString()}];receipts.push({bid:{...initial.bid,id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString()},hold:initial.hold,charge:{feePoints:fee.feePoints.toString(),newlyUnavailable:fee.feePoints.toString(),...(used?{bonusUsed:centsToEtb(used)}:{})},wallet:{available:new Prisma.Decimal(centsToEtb(availableCents)).toString(),held:initial.wallet.held,cashAvailable:centsToEtb(cashCents),bonusAvailable:centsToEtb(bonusCents),bonusExpiresAt:bonusCents>0n?initial.wallet.bonusExpiresAt:null},remainingSubmissions:initial.remainingSubmissions-child.line.position,ownBids:own})}
  await tx.operation.createMany({data:children.map((child,index)=>({id:child.operationId,userId:batch.userId,scope:'BID',key:batchChildKey(batch.id,child.line.position),requestHash:chapaHash(JSON.stringify({auctionSlug:batch.auctionSlug,amount:new Prisma.Decimal(child.line.number).toString(),feeVersion:batch.feeVersion})),result:JSON.parse(JSON.stringify(receipts[index+1]))}))});
  if(fee.feePoints.gt(0)){
   await tx.journal.createMany({data:children.map(child=>({id:child.journalId,operationId:child.operationId,kind:'BID_FEE',reference:`bid:${child.id}`}))});
   await tx.posting.createMany({data:children.flatMap(child=>[{journalId:child.journalId,accountId:available!.id,delta:fee.feePoints.negated()},{journalId:child.journalId,accountId:fees!.id,delta:fee.feePoints}])});
  }
  await tx.auction.update({where:{id:batch.auctionId},data:{acceptedBidCount:{increment:rest.length}}});
 }
 const receipt={...receipts.at(-1)!,bid:receipts[0].bid,bids:receipts.map(item=>item.bid),receipts,batchId:batch.id,total:centsToEtb(batch.totalCents),charge:{feePoints:centsToEtb(batch.grossCents),discountPoints:centsToEtb(batch.discountCents),netFeePoints:centsToEtb(batch.totalCents),newlyUnavailable:centsToEtb(batch.totalCents)}};
 await tx.bidBatchOrder.update({where:{id:batch.id},data:{status:'ACCEPTED',receipt:JSON.parse(JSON.stringify(receipt))}});
 // One immutable notification intent for the committed complete purchase,
 // instead of up to 100 messages. Replay returns above without another intent.
 const alert=await tx.outbox.create({data:{key:`bid-batch:${batch.id}:accepted`,kind:'BID_ACCEPTED',payload:{auctionId:batch.auctionId,recipientUserId:batch.userId,batchId:batch.id,bidId:initial.bid.id}}});
 const snapshot=current.auction.presentation as {title?:string;titleAm?:string}|null;
 const copy=bidPurchaseNotificationCopy({productTitle:snapshot?.titleAm||current.auction.product?.titleAm||snapshot?.title||current.auction.product?.title||'',numbers:lines.map(line=>line.number),paidFee:centsToEtb(batch.totalCents),ruleVersion:batch.ruleVersion});
 if(copy)await materializeAlert(tx,alert,{...copy,userId:batch.userId,kind:'BID_ACCEPTED',href:'/my-bids'});
 return receipt;
}
export async function payBidBatchWallet(client:PrismaClient,userId:string,id:string,raw:unknown,reauthorize?:Authorize){
 z.string().uuid().parse(id);const {quoteHash}=z.object({quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
 return client.$transaction(async tx=>{
  const snapshot=await tx.bidBatchOrder.findFirst({where:{id,userId}});if(!snapshot)throw new ChapaError(404,'NOT_FOUND','Order not found.');
  // Take the shared maintenance barrier before auction/wallet locks, matching
  // every other auction writer and preventing an inverse maintenance lock wait.
  const halted=await measureChapa('locks',()=>lockBatchWriter(tx,userId,snapshot.auctionSlug,true));await tx.$queryRaw`SELECT id FROM "BidBatchOrder" WHERE id=${id} FOR UPDATE`;
  if(reauthorize)await reauthorize(tx);const batch=await tx.bidBatchOrder.findUniqueOrThrow({where:{id}});
  if(batch.quoteHash!==quoteHash)throw new ChapaError(409,'TERMS_CHANGED','Review the current order before paying.');
  // A receipt accepted through Chapa remains an external payment. Only an
  // internal-wallet order may replay through this adapter, even after success.
  if(await tx.chapaCheckout.findUnique({where:{batchId:id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has an online payment. Check that original payment.');
  if(batch.status==='ACCEPTED'){
   const receipt=batch.receipt as unknown as BidReceipt&{receipts:BidReceipt[]};
   return walletBatchReceipt(batch,receipt,await readWalletProjection(tx,userId));
  }
  if(halted)throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
  return acceptWalletBatch(tx,batch);
 },PAYMENT_TRANSACTION_OPTIONS);
}

async function acceptWalletBatch(tx:Tx,batch:BidBatchOrder,validated?:Awaited<ReturnType<typeof validateBatchInTransaction>>){
 rejectRetiredCoupon(batch.couponId);
 if(batch.totalCents>0n&&!walletBidsEnabled())throw new ChapaError(503,'WALLET_UNAVAILABLE','Wallet payments are currently unavailable.');
 const current=validated??await measureChapa('pricing',()=>validateBatchInTransaction(tx,batch.userId,batch.auctionSlug,batchLines(batch).map(line=>line.number),batch.feeVersion,undefined,true));
 const receipt=await measureChapa('fulfill',()=>fulfillBatchInTransaction(tx,batch,{validated:current,allowDepositBonus:true}));
 return walletBatchReceipt({...batch,status:'ACCEPTED'},receipt,await readWalletProjection(tx,batch.userId));
}

/** A new wallet checkout uses one authenticated command/transaction. The quote
 * remains immutable, and a changed approved total returns it without a debit.
 * The selection key is the durable operation key, including after a lost reply. */
export async function createAndPayBidBatchWallet(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize){
 const {approvedTotal,...input}=command.extend({approvedTotal:z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)}).strict().parse(raw),numbers=normalizeBatchNumbers(input.numbers),requestHash=chapaHash(JSON.stringify({...input,numbers,approvedTotal:centsToEtb(etbToCents(approvedTotal))}));
 const cashCommand=reauthorize?.forWalletCashCommand;
 if(cashCommand&&!input.couponId){
  const receipt=await measureChapa('cash_command',()=>cashCommand(client,userId,{key:input.key,auctionSlug:input.auctionSlug,numbers,feeVersion:input.feeVersion,approvedTotal:centsToEtb(etbToCents(approvedTotal)),requestHash}));
  if(receipt)return receipt;
 }
 return client.$transaction(async tx=>{
  const halted=await measureChapa('locks',()=>lockBatchWriter(tx,userId,input.auctionSlug,true));
  const check=reauthorize?.forWalletBatch;
  const fresh=check?await measureChapa('reauthorize',()=>check(tx,userId,input.key)):null;
  if(!fresh&&reauthorize)await reauthorize(tx);
  let batch=fresh?.replayExists===false?null:await tx.bidBatchOrder.findUnique({where:{userId_key:{userId,key:input.key}}});
  if(batch&&batch.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Changed selections require a new order.');
  if(batch&&await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has an online payment. Check that original payment.');
  if(batch?.status==='ACCEPTED')return {kind:'receipt' as const,receipt:walletBatchReceipt(batch,batch.receipt as unknown as BidReceipt&{receipts:BidReceipt[]},await readWalletProjection(tx,userId))};
  rejectRetiredCoupon(input.couponId??batch?.couponId);
  if(halted)throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
  if(fresh)fresh.assertEligible();
  const priced=await measureChapa('pricing',()=>fresh?priceBatchInTransaction(tx,userId,input.auctionSlug,numbers,input.feeVersion):validateBatchInTransaction(tx,userId,input.auctionSlug,numbers,input.feeVersion,undefined,true));
  if(!batch)batch=await persistBidBatchQuoteInTransaction(tx,userId,input,priced,requestHash);
  if(batch.totalCents!==priced.totalCents||JSON.stringify(batchLines(batch))!==JSON.stringify(priced.lines))throw new ChapaError(409,'TERMS_CHANGED','The quote changed. Review the updated fee before paying.');
  if(batch.totalCents!==etbToCents(approvedTotal))return {kind:'quote' as const,quote:ownBatch(batch)};
  return {kind:'receipt' as const,receipt:await acceptWalletBatch(tx,batch,priced)};
 },PAYMENT_TRANSACTION_OPTIONS);
}

/** Read the owned original operation only. Unknown/uncommitted and quoted rows
 * stay pending; this never creates a quote, debits funds or invokes Chapa. */
export async function getOwnWalletBidBatch(client:PrismaClient,userId:string,selector:{key:string}|{id:string;quoteHash:string},reauthorize?:Authorize){
 const identity='key' in selector?{key:z.string().uuid().parse(selector.key)}:{id:z.string().uuid().parse(selector.id),quoteHash:z.string().regex(/^[a-f0-9]{64}$/).parse(selector.quoteHash)};
 return client.$transaction(async tx=>{
  if(reauthorize)await reauthorize(tx);
  const batch=await tx.bidBatchOrder.findFirst({where:{userId,...('key' in identity?{key:identity.key}:{id:identity.id})}});
  if('id' in identity&&!batch)throw new ChapaError(404,'NOT_FOUND','Order not found.');
  if(batch&&'quoteHash' in identity&&batch.quoteHash!==identity.quoteHash)throw new ChapaError(409,'TERMS_CHANGED','Review the original order before checking its payment.');
  if(batch&&await tx.chapaCheckout.findUnique({where:{batchId:batch.id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order has an online payment. Check that original payment.');
  if(batch?.status==='ACCEPTED'&&batch.receipt)return {kind:'receipt' as const,receipt:walletBatchReceipt(batch,batch.receipt as unknown as BidReceipt&{receipts:BidReceipt[]},await readWalletProjection(tx,userId))};
  return {kind:'pending' as const,status:'PENDING' as const,batchId:batch?.id??null,pollAfterMs:1000};
 },{...PAYMENT_TRANSACTION_OPTIONS,isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
