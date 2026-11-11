import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type BidBatchOrder,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb,etbToCents} from '@/lib/money';
import {assertPlayerContact} from '../auth/own-contact';
import {lockReferralDiscountInTransaction} from '../referrals/service';
import {ChapaError,chapaHash} from '../payments/chapa-provider';
import {PAYMENT_TRANSACTION_OPTIONS} from '../payments/timing';
import {BidError,submitBidInTransaction,type BidReceipt} from './bids';
import {createsFourConsecutiveAmounts,parseBidCents} from './consecutive-bids';
import {auctionMaintenance} from './maintenance';
import {isSubmissionFeeOnly} from './rules';
import {walletBidsEnabled} from '../wallet/policy';
import {readWalletProjection} from '../wallet/balance';

type Tx=Prisma.TransactionClient;
type Authorize=(tx:Tx)=>Promise<void>;
const command=z.object({key:z.string().uuid(),auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),numbers:z.array(z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)).min(1).max(100),feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional()}).strict();
const lineSchema=z.object({position:z.number().int().nonnegative(),number:z.string(),grossFee:z.string(),discount:z.string(),netFee:z.string(),couponId:z.string().uuid().optional()}).strict();
export type BatchLine=z.infer<typeof lineSchema>;
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
 return {batch:ownBatch(batch),receipts:publicBatchReceipt(receipt.receipts),wallet:{available:centsToEtb(etbToCents(wallet.available)),held:centsToEtb(etbToCents(wallet.held)),revision:wallet.revision},payment:{method:'wallet' as const,gateway:'INTERNAL_WALLET' as const,total:centsToEtb(batch.totalCents),acceptedBidIds:receipt.receipts.map(item=>item.bid.id)}};
}
export async function validateBatchInTransaction(tx:Tx,userId:string,slug:string,numbers:string[],feeVersion:number,couponId?:string){
 if(await auctionMaintenance(tx))throw new ChapaError(503,'AUCTIONS_PAUSED','Auctions are paused. Existing funds remain safe.');
 await tx.$queryRaw`SELECT id FROM "Auction" WHERE slug=${slug} FOR UPDATE`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;
 await assertPlayerContact(tx,userId);
 if(await tx.staffMember.findUnique({where:{userId}})||(await tx.userRestriction.findUnique({where:{userId}}))?.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.');
 const auction=await tx.auction.findUnique({where:{slug},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},product:{include:{category:true}},category:true}}),[{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 if(!auction?.publishedAt||auction.publishedAt>now||!auction.startsAt||auction.startsAt>now||!auction.endsAt||auction.endsAt<=now||!['SCHEDULED','LIVE'].includes(auction.status)||!auction.product?.visible||!auction.product.category.visible||!auction.category?.visible)throw new ChapaError(409,'AUCTION_CLOSED','This auction is closed.');
 if(auction.isDemo||auction.testRunId||auction.product.isDemo||!auction.terms||!isSubmissionFeeOnly(auction.terms.ruleVersion))throw new ChapaError(409,'LEGACY_TERMS','This order supports real submission-fee auctions only.');
 const terms=auction.terms,fee=auction.feeRevisions[0];
 if(!fee||fee.version!==feeVersion)throw new ChapaError(409,'TERMS_CHANGED','The fee changed. Review a new quote before paying.');
 const normalized=normalizeBatchNumbers(numbers),own=await tx.bid.findMany({where:{userId,auctionId:auction.id},select:{amount:true}});
 if(own.length+normalized.length>terms.maxDistinctBids)throw new ChapaError(409,'CAP_REACHED','These entries exceed your remaining submissions.');
 const accepted=own.map(item=>parseBidCents(item.amount.toString())),seen=new Set(accepted.map(String));
 for(const number of normalized){const n=new Prisma.Decimal(number),cents=parseBidCents(number);if(n.lt(1)||n.lt(terms.minPoints)||terms.maxPoints!==null&&n.gt(terms.maxPoints)||!n.sub(terms.minPoints).mod(terms.stepPoints).isZero())throw new ChapaError(422,'INVALID_AMOUNT','Choose amounts within the published bounds and increment.');if(seen.has(String(cents)))throw new ChapaError(409,'OWN_DUPLICATE','You already submitted one of these amounts.');if(createsFourConsecutiveAmounts(accepted,cents))throw new ChapaError(422,'CONSECUTIVE_LIMIT','Leave a gap after three consecutive amounts.');accepted.push(cents);seen.add(String(cents))}
 const discount=couponId?await lockReferralDiscountInTransaction(tx,userId,couponId,fee.feePoints,terms.ruleVersion):null;
 const lines:BatchLine[]=normalized.map((number,position)=>{const saving=position===0&&discount?discount.discountPoints:new Prisma.Decimal(0);return {position,number,grossFee:fee.feePoints.toFixed(2),discount:saving.toFixed(2),netFee:fee.feePoints.sub(saving).toFixed(2),...(position===0&&couponId?{couponId}:{})}});
 const grossCents=etbToCents(fee.feePoints.toFixed(2))*BigInt(lines.length),discountCents=discount?etbToCents(discount.discountPoints.toFixed(2)):0n;
 if(grossCents>4320000n)throw new ChapaError(422,'INVALID_AMOUNT','Split this selection into smaller orders.');
 return {auction,lines,totalCents:grossCents-discountCents,grossCents,discountCents};
}
export async function quoteBidBatch(client:PrismaClient,userId:string,raw:unknown,reauthorize?:Authorize){
 const input=command.parse(raw),numbers=normalizeBatchNumbers(input.numbers),requestHash=chapaHash(JSON.stringify({...input,numbers}));
 return client.$transaction(async tx=>{
  const previous=await tx.bidBatchOrder.findUnique({where:{userId_key:{userId,key:input.key}}});
  if(previous){if(previous.requestHash!==requestHash)throw new ChapaError(409,'KEY_REUSED','Changed selections require a new quote.');return ownBatch(previous)}
  if(reauthorize)await reauthorize(tx);
  const priced=await validateBatchInTransaction(tx,userId,input.auctionSlug,numbers,input.feeVersion,input.couponId);
  return ownBatch(await persistBidBatchQuoteInTransaction(tx,userId,input,priced,requestHash));
 },PAYMENT_TRANSACTION_OPTIONS);
}
/** Called after authoritative validation while the auction/wallet locks remain
 * held. Shared by quote-only and one-command direct checkout preparation. */
export async function persistBidBatchQuoteInTransaction(tx:Tx,userId:string,input:{key:string;auctionSlug:string;feeVersion:number;couponId?:string},priced:Awaited<ReturnType<typeof validateBatchInTransaction>>,requestHash:string){
 const id=randomUUID(),quoteHash=chapaHash(JSON.stringify({id,userId,ruleVersion:priced.auction.terms!.ruleVersion,feeVersion:input.feeVersion,lines:priced.lines,totalCents:String(priced.totalCents)}));
 return tx.bidBatchOrder.create({data:{id,userId,key:input.key,requestHash,quoteHash,auctionId:priced.auction.id,auctionSlug:input.auctionSlug,ruleVersion:priced.auction.terms!.ruleVersion,feeVersion:input.feeVersion,lines:priced.lines,totalCents:priced.totalCents,grossCents:priced.grossCents,discountCents:priced.discountCents,couponId:input.couponId}});
}
export async function fulfillBatchInTransaction(tx:Tx,batch:BidBatchOrder){
 const prior=await tx.bidBatchOrder.findUniqueOrThrow({where:{id:batch.id}});
 if(prior.status==='ACCEPTED'&&prior.receipt)return prior.receipt as unknown as BidReceipt&{bids:BidReceipt['bid'][];receipts:BidReceipt[]};
 const lines=batchLines(batch),current=await validateBatchInTransaction(tx,batch.userId,batch.auctionSlug,lines.map(item=>item.number),batch.feeVersion,batch.couponId??undefined);
 if(current.auction.terms!.ruleVersion!==batch.ruleVersion||current.totalCents!==batch.totalCents||JSON.stringify(current.lines)!==JSON.stringify(lines))throw new ChapaError(409,'TERMS_CHANGED','The quote or coupon changed. No bids were accepted.');
 // validateBatchInTransaction holds the shared wallet writer lock. Reject an
 // unaffordable complete order before creating even the first entry/outbox row.
 // Zero-fee coupon orders remain valid without creating a gateway payment.
 if(batch.totalCents>0n){
  const account=await tx.ledgerAccount.findUnique({where:{name:`user:${batch.userId}:available`},select:{balance:true}}),available=etbToCents(account?.balance.toFixed(2)??'0');
  if(available<batch.totalCents)throw new BidError('INSUFFICIENT_POINTS',409,'Your Lowwin Wallet balance is too low.',{available:centsToEtb(available),required:centsToEtb(batch.totalCents),shortfall:centsToEtb(batch.totalCents-available),currency:'ETB'});
 }
 // Run the first entry through the existing authoritative command, including
 // coupon redemption and genuine first-bid referral qualification. Subsequent
 // entries share the same locked, fully validated batch and use bulk writes.
 // The database Bid triggers still stamp/check every acceptance individually;
 // any late/invalid line aborts the entire outer transaction/savepoint.
 const first=lines[0],initial=await submitBidInTransaction(tx,{userId:batch.userId,auctionSlug:batch.auctionSlug,amount:first.number,feeVersion:batch.feeVersion,key:batchChildKey(batch.id,0),...(first.couponId?{couponId:first.couponId}:{})},process.env,{submissionFeeOnly:true}),receipts:BidReceipt[]=[initial];
 if(etbToCents(initial.charge.netFeePoints??initial.charge.feePoints)!==etbToCents(first.netFee))throw new ChapaError(409,'TERMS_CHANGED','The charged fee no longer matches this quote.');
 const rest=lines.slice(1),remainingCost=batch.totalCents-etbToCents(first.netFee);
 if(etbToCents(initial.wallet.available)<remainingCost)throw new BidError('INSUFFICIENT_POINTS',409,'Your Lowwin wallet does not have enough funds for the entire order.');
 if(rest.length){
  const fee=current.auction.feeRevisions[0],accounts=await tx.ledgerAccount.findMany({where:{name:{in:[`user:${batch.userId}:available`,'platform:fees']}},select:{id:true,name:true}}),available=accounts.find(account=>account.name===`user:${batch.userId}:available`),fees=accounts.find(account=>account.name==='platform:fees');
  if(!available||fee.feePoints.gt(0)&&!fees)throw new ChapaError(503,'PAYMENT_UNAVAILABLE','Payment accounts could not be loaded. Retry this same order.');
  const children=rest.map(line=>({line,id:randomUUID(),operationId:randomUUID(),journalId:randomUUID()}));
  const inserted=await tx.bid.createManyAndReturn({data:children.map(child=>({id:child.id,operationId:child.operationId,userId:batch.userId,auctionId:batch.auctionId,amount:new Prisma.Decimal(child.line.number),termsVersion:batch.feeVersion,feePoints:fee.feePoints,feeRevisionId:fee.id})),select:{id:true,amount:true,acceptedAt:true}}),byId=new Map(inserted.map(bid=>[bid.id,bid]));
  let availableCents=etbToCents(initial.wallet.available),own=initial.ownBids;
  for(const child of children){const bid=byId.get(child.id)!;availableCents-=etbToCents(child.line.netFee);own=[...own,{id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString()}];receipts.push({bid:{...initial.bid,id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString()},hold:initial.hold,charge:{feePoints:fee.feePoints.toString(),newlyUnavailable:fee.feePoints.toString()},wallet:{available:new Prisma.Decimal(centsToEtb(availableCents)).toString(),held:initial.wallet.held},remainingSubmissions:initial.remainingSubmissions-child.line.position,ownBids:own})}
  await tx.operation.createMany({data:children.map((child,index)=>({id:child.operationId,userId:batch.userId,scope:'BID',key:batchChildKey(batch.id,child.line.position),requestHash:chapaHash(JSON.stringify({auctionSlug:batch.auctionSlug,amount:new Prisma.Decimal(child.line.number).toString(),feeVersion:batch.feeVersion})),result:JSON.parse(JSON.stringify(receipts[index+1]))}))});
  if(fee.feePoints.gt(0)){
   await tx.journal.createMany({data:children.map(child=>({id:child.journalId,operationId:child.operationId,kind:'BID_FEE',reference:`bid:${child.id}`}))});
   await tx.posting.createMany({data:children.flatMap(child=>[{journalId:child.journalId,accountId:available!.id,delta:fee.feePoints.negated()},{journalId:child.journalId,accountId:fees!.id,delta:fee.feePoints}])});
  }
  await tx.auction.update({where:{id:batch.auctionId},data:{acceptedBidCount:{increment:rest.length}}});
  // Equivalent to enqueueAlert for this already validated real, open auction.
  // Bulk insertion avoids per-entry auction/content re-reads and keeps every
  // notification inside the same all-or-none financial transaction.
  await tx.outbox.createMany({data:children.map(child=>({key:`bid:${child.id}:accepted`,kind:'BID_ACCEPTED',payload:{auctionId:batch.auctionId,recipientUserId:batch.userId}}))});
  await tx.notificationInbox.createMany({data:children.map(child=>({key:`bid:${child.id}:accepted`,kind:'BID_ACCEPTED',userId:batch.userId,title:'Bid accepted',body:'Your accepted receipt is ready in My Bids.',href:'/my-bids'}))});
 }
 const receipt={...receipts.at(-1)!,bid:receipts[0].bid,bids:receipts.map(item=>item.bid),receipts,batchId:batch.id,total:centsToEtb(batch.totalCents),charge:{feePoints:centsToEtb(batch.grossCents),discountPoints:centsToEtb(batch.discountCents),netFeePoints:centsToEtb(batch.totalCents),newlyUnavailable:centsToEtb(batch.totalCents)}};
 await tx.bidBatchOrder.update({where:{id:batch.id},data:{status:'ACCEPTED',receipt:JSON.parse(JSON.stringify(receipt))}});
 return receipt;
}
export async function payBidBatchWallet(client:PrismaClient,userId:string,id:string,raw:unknown,reauthorize?:Authorize){
 z.string().uuid().parse(id);const {quoteHash}=z.object({quoteHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
 return client.$transaction(async tx=>{
  const snapshot=await tx.bidBatchOrder.findFirst({where:{id,userId}});if(!snapshot)throw new ChapaError(404,'NOT_FOUND','Order not found.');
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${snapshot.auctionId} FOR UPDATE`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await tx.$queryRaw`SELECT id FROM "BidBatchOrder" WHERE id=${id} FOR UPDATE`;
  if(reauthorize)await reauthorize(tx);const batch=await tx.bidBatchOrder.findUniqueOrThrow({where:{id}});
  if(batch.quoteHash!==quoteHash)throw new ChapaError(409,'TERMS_CHANGED','Review the current order before paying.');
  // A receipt accepted through Chapa remains an external payment. Only an
  // internal-wallet order may replay through this adapter, even after success.
  if(await tx.chapaCheckout.findUnique({where:{batchId:id}}))throw new ChapaError(409,'PAYMENT_STARTED','This order already has an online payment. Check that original payment.');
  if(batch.status==='ACCEPTED'){
   const receipt=batch.receipt as unknown as BidReceipt&{receipts:BidReceipt[]};
   return walletBatchReceipt(batch,receipt,await readWalletProjection(tx,userId));
  }
  if(batch.totalCents>0n&&!walletBidsEnabled())throw new ChapaError(503,'WALLET_UNAVAILABLE','Wallet payments are currently unavailable.');
  const receipt=await fulfillBatchInTransaction(tx,batch);return walletBatchReceipt(await tx.bidBatchOrder.findUniqueOrThrow({where:{id}}),receipt,await readWalletProjection(tx,userId));
 },PAYMENT_TRANSACTION_OPTIONS);
}
