import {isSubmissionFeeOnly,usesDecimalBids} from './rules';
import {createsFourConsecutiveAmounts,parseBidCents} from './consecutive-bids';
import {formatEtb} from '@/lib/money';
import {assertPlayerContact} from '../auth/own-contact';
import {stagingDemoUser} from './staging-demo';
import {enqueueAlert} from '../notifications/service';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { adjustAuctionHoldInTransaction } from '@/modules/wallet/holds';
import { ensureWallet, pointsSchema, seedPlatformAccounts } from '@/modules/wallet/ledger';
import {lockReferralDiscountInTransaction,qualifyReferralInTransaction,redeemReferralInTransaction,referralSchemaReady,ReferralError} from '../referrals/service';

const bidInputSchema = z.object({
  userId:z.string().min(1).max(128),
  auctionSlug:z.string().regex(/^[a-z0-9-]{1,120}$/),
  amount:pointsSchema.refine(value=>value.gt(0)),
  key:z.string().uuid(),
  feeVersion:z.number().int().min(1).optional(),
  couponId:z.string().uuid().optional(),
}).strict();
export type BidInput=z.input<typeof bidInputSchema>;
const ownBidSchema=z.object({id:z.string(),amount:z.string(),acceptedAt:z.string()});
const receiptSchema=z.object({
  bid:z.object({id:z.string(),auctionCode:z.string(),auctionSlug:z.string(),amount:z.string(),acceptedAt:z.string(),termsVersion:z.number(),feePoints:z.string()}),
  hold:z.object({previousMax:z.string(),newMax:z.string(),extraReserved:z.string()}),
  charge:z.object({feePoints:z.string(),newlyUnavailable:z.string(),discountPoints:z.string().optional(),netFeePoints:z.string().optional(),couponId:z.string().optional()}),
  wallet:z.object({available:z.string(),held:z.string()}),
  remainingSubmissions:z.number(),ownBids:z.array(ownBidSchema),
});
export type BidReceipt=z.infer<typeof receiptSchema>;
export type DirectBidReceipt=Omit<BidReceipt,'wallet'>;

export type BidErrorCode='AUCTION_NOT_FOUND'|'AUCTION_CLOSED'|'DEMO_UNAVAILABLE'|'INVALID_AMOUNT'|'CONSECUTIVE_LIMIT'|'OWN_DUPLICATE'|'CAP_REACHED'|'INSUFFICIENT_POINTS'|'KEY_REUSED'|'RETRYABLE_CONFLICT'|'BIDDING_RESTRICTED'|'CONTACT_REQUIRED'|'COUPON_UNAVAILABLE';
export class BidError extends Error {
  constructor(public readonly code:BidErrorCode,public readonly status:number,message:string){super(message);this.name='BidError';}
}
function fail(code:BidErrorCode,status:number,message:string):never {throw new BidError(code,status,message)}

export function demoBidAllowed(raw:Record<string,string|undefined>=process.env) {
  try {
    const url=new URL(raw.DATABASE_URL??'');
    return raw.NODE_ENV!=='production' && !raw.VERCEL && ['local','test'].includes(raw.APP_ENV??'')
      && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && url.pathname.endsWith('_test');
  } catch {return false;}
}
export async function submitBidInTransaction(tx:Prisma.TransactionClient,input:BidInput,raw:Record<string,string|undefined>=process.env):Promise<BidReceipt> {
  const command=bidInputSchema.parse(input);
  const {userId,auctionSlug,amount,key,feeVersion,couponId}=command;
  const requestHash=createHash('sha256').update(JSON.stringify({auctionSlug,amount:amount.toString(),feeVersion,couponId})).digest('hex');

  // Global order for writers: auction row -> wallet advisory key -> wallet hold
  // guard/projections. The SQL Bid trigger re-locks the auction row and stamps
  // acceptance time after any wait. Never retry only part of this transaction.
  const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Auction" WHERE slug=${auctionSlug} FOR UPDATE`;
  if(!locked.length)fail('AUCTION_NOT_FOUND',404,'Auction not found.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`}, 0))`;
  try{await assertPlayerContact(tx,userId)}catch{fail('CONTACT_REQUIRED',403,'Share your own contact in Telegram before bidding.')}
  const previous=await tx.operation.findUnique({where:{userId_scope_key:{userId,scope:'BID',key}}});
  if(previous){
    if(previous.requestHash!==requestHash)fail('KEY_REUSED',409,'This request key was already used with a different bid.');
    return receiptSchema.parse(previous.result);
  }
  if(await tx.staffMember.findUnique({where:{userId}})|| (await tx.userRestriction.findUnique({where:{userId}}))?.suspended)fail('BIDDING_RESTRICTED',403,'Bidding is unavailable for staff or suspended accounts. Existing bids remain valid.');
  const clock=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  const now=clock[0].now;
  const auction=await tx.auction.findUniqueOrThrow({where:{id:locked[0].id},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1},product:{include:{category:true}},category:true}});
  if(!auction.publishedAt||auction.publishedAt>now||!auction.startsAt||!auction.endsAt||
    !['SCHEDULED','LIVE'].includes(auction.status)||now<auction.startsAt||now>=auction.endsAt||
    !auction.product?.visible||!auction.product.category.visible||!auction.category?.visible)
    fail('AUCTION_CLOSED',409,'This auction is not open for bids.');
  if(auction.isDemo&&!demoBidAllowed(raw)&&!(auction.isSettlementFixture&&stagingDemoUser(userId,raw)))fail('DEMO_UNAVAILABLE',403,'DEMO bidding is limited to explicitly enrolled staging testers.');
  const terms=auction.terms;
  if(!terms)fail('AUCTION_CLOSED',409,'Published auction terms are unavailable.');
  const fee=auction.feeRevisions[0];
  if(!fee||isSubmissionFeeOnly(terms.ruleVersion)&&feeVersion===undefined||feeVersion!==undefined&&fee.version!==feeVersion)fail('RETRYABLE_CONFLICT',409,'Bidding terms changed. Review the current amount and confirm again.');
  if((usesDecimalBids(terms.ruleVersion)&&amount.lt(1))||amount.lt(terms.minPoints)||(terms.maxPoints!==null&&amount.gt(terms.maxPoints))||!amount.sub(terms.minPoints).mod(terms.stepPoints).isZero())
    fail('INVALID_AMOUNT',422,terms.maxPoints===null?`Choose a bid number of at least ${terms.minPoints} in steps of ${terms.stepPoints}.`:`Choose a bid number from ${terms.minPoints} to ${terms.maxPoints} in steps of ${terms.stepPoints}.`);

  const own=await tx.bid.findMany({where:{userId,auctionId:auction.id},orderBy:[{acceptedAt:'asc'},{id:'asc'}],select:{id:true,amount:true,acceptedAt:true}});
  if(own.some(bid=>bid.amount.eq(amount)))fail('OWN_DUPLICATE',409,'You already submitted this bid number for this auction.');
  if(usesDecimalBids(terms.ruleVersion)&&createsFourConsecutiveAmounts(own.map(b=>parseBidCents(b.amount.toString())),parseBidCents(amount.toString())))fail('CONSECUTIVE_LIMIT',422,'Leave a gap after three consecutive numbers separated by 0.01.');
  if(own.length>=terms.maxDistinctBids)fail('CAP_REACHED',409,'You have reached the 100 distinct-bid limit for this auction.');

  const wallet=await ensureWallet(tx,userId);
  const accounts=await tx.ledgerAccount.findMany({where:{walletId:wallet.id}});
  const available=accounts.find(account=>account.kind==='AVAILABLE')!;
  const held=accounts.find(account=>account.kind==='HELD')!;
  const hold=await tx.auctionHold.findUnique({where:{walletId_auctionId:{walletId:wallet.id,auctionId:auction.id}}});
  const previousMax=hold?.points??new Prisma.Decimal(0);
  const extraReserved=isSubmissionFeeOnly(terms.ruleVersion)?new Prisma.Decimal(0):Prisma.Decimal.max(amount.sub(previousMax),0);
  let discount:Awaited<ReturnType<typeof lockReferralDiscountInTransaction>>|null=null;
  if(couponId){
    if(auction.isDemo||auction.testRunId||auction.product.isDemo)fail('COUPON_UNAVAILABLE',409,'Earned discounts apply to real submission-fee auctions only.');
    try{discount=await lockReferralDiscountInTransaction(tx,userId,couponId,fee.feePoints,terms.ruleVersion,raw)}catch(error){if(error instanceof ReferralError)fail('COUPON_UNAVAILABLE',error.status,error.message);throw error}
  }
  const newlyUnavailable=extraReserved.add(discount?.netFeePoints??fee.feePoints);
  if(available.balance.lt(newlyUnavailable))fail('INSUFFICIENT_POINTS',409,`You need ${formatEtb(newlyUnavailable)} available for this bid${fee.feePoints.gt(0)?' and its disclosed fee':''}.`);

  const bidId=randomUUID(),operationId=randomUUID();
  // This FK is deferred: the immutable BID operation can include the exact
  // database-stamped acceptedAt in its original receipt when inserted below.
  const bid=await tx.bid.create({data:{id:bidId,userId,auctionId:auction.id,amount,termsVersion:fee.version,feePoints:fee.feePoints,feeRevisionId:fee.id,operationId}});
  await tx.auction.update({where:{id:auction.id},data:{acceptedBidCount:{increment:1}}});
  if(extraReserved.gt(0))await adjustAuctionHoldInTransaction(tx,{userId,auctionId:auction.id,direction:'RESERVE',points:extraReserved.toString(),key:`bid-hold:${createHash('sha256').update(`${userId}:${key}`).digest('hex')}`,reference:`bid:${bid.id}`});
  if(fee.feePoints.gt(0))await seedPlatformAccounts(tx);
  const receipt:BidReceipt={
    bid:{id:bid.id,auctionCode:auction.code,auctionSlug,amount:amount.toString(),acceptedAt:bid.acceptedAt.toISOString(),termsVersion:fee.version,feePoints:fee.feePoints.toString()},
    hold:{previousMax:previousMax.toString(),newMax:previousMax.add(extraReserved).toString(),extraReserved:extraReserved.toString()},
    charge:{feePoints:fee.feePoints.toString(),newlyUnavailable:newlyUnavailable.toString(),...(discount?{discountPoints:discount.discountPoints.toString(),netFeePoints:discount.netFeePoints.toString(),couponId:discount.couponId}:{})},
    wallet:{available:available.balance.sub(newlyUnavailable).toString(),held:held.balance.add(extraReserved).toString()},
    remainingSubmissions:terms.maxDistinctBids-own.length-1,
    ownBids:[...own.map(item=>({id:item.id,amount:item.amount.toString(),acceptedAt:item.acceptedAt.toISOString()})),{id:bid.id,amount:amount.toString(),acceptedAt:bid.acceptedAt.toISOString()}],
  };
  await tx.operation.create({data:{id:operationId,userId,scope:'BID',key,requestHash,result:receipt}});
  if(discount)await redeemReferralInTransaction(tx,userId,bid.id,auction.id,discount);
  if(fee.feePoints.gt(0)){
    const fees=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}});
    await tx.journal.create({data:{operationId,kind:'BID_FEE',reference:`bid:${bid.id}`,postings:{create:[
      {accountId:available.id,delta:fee.feePoints.negated()},{accountId:fees.id,delta:fee.feePoints},
    ]}}});
  }
  await enqueueAlert(tx,{key:`bid:${bid.id}:accepted`,kind:'BID_ACCEPTED',auctionId:auction.id,userId});
  await qualifyReferralInTransaction(tx,userId,bid.id,raw);
  return receipt;
}

export async function submitBid(client:PrismaClient,input:BidInput,raw:Record<string,string|undefined>=process.env) {
  try {
    return await client.$transaction(tx=>submitBidInTransaction(tx,input,raw),{
      isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:15000,timeout:30000,
    });
  } catch(error) {
    if(error instanceof BidError||error instanceof z.ZodError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('Referral redemption')||message.includes('Referral coupon'))fail('COUPON_UNAVAILABLE',409,'This earned discount changed or expired. Review the fee and retry.');
    if(message.includes('Auction is not open for bids'))fail('AUCTION_CLOSED',409,'This auction closed before your bid was accepted.');
    if(message.includes('Four consecutive cent amounts'))fail('CONSECUTIVE_LIMIT',422,'Leave a gap after three consecutive numbers separated by 0.01.');
    if(message.includes('Distinct bid limit reached'))fail('CAP_REACHED',409,'You have reached the 100 distinct-bid limit for this auction.');
    if(message.includes('stale')||message.includes('current fee revision'))fail('RETRYABLE_CONFLICT',409,'Bidding terms changed. Review the current amount and confirm again.');
    if(message.includes('Bid does not match published terms'))fail('INVALID_AMOUNT',422,'The published ETB terms changed or this amount is invalid.');
    if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2034','P2028'].includes(error.code))
      fail('RETRYABLE_CONFLICT',409,'This auction is busy. Retry the same request key.');
    throw error;
  }
}

export async function getOwnBidState(client:PrismaClient,userId:string,auctionSlug:string,raw:Record<string,string|undefined>=process.env,includeWallet=true) {
  return client.$transaction(async tx=>{
    const auction=await tx.auction.findUnique({where:{slug:auctionSlug},include:{terms:true,feeRevisions:{orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1}}});
    if(!auction||!auction.publishedAt||!auction.terms)fail('AUCTION_NOT_FOUND',404,'Auction not found.');
    const clock=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    const now=clock[0].now;
    const [wallet,bids]=await Promise.all([
      includeWallet?tx.wallet.findUnique({where:{userId},include:{accounts:true,holds:{where:{auctionId:auction.id}}}}):Promise.resolve(null),
      tx.bid.findMany({where:{userId,auctionId:auction.id},orderBy:[{acceptedAt:'asc'},{id:'asc'}],select:{id:true,amount:true,acceptedAt:true}}),
    ]);
    const terms=auction.terms,fee=auction.feeRevisions[0],previousMax=wallet?.holds[0]?.points??0n;
    if(!fee)fail('AUCTION_CLOSED',409,'Published auction fee is unavailable.');
    const restricted=!!await tx.staffMember.findUnique({where:{userId}})||(await tx.userRestriction.findUnique({where:{userId}}))?.suspended;
    return {auctionCode:auction.code,referralDiscountsAvailable:referralSchemaReady(raw),open:!restricted&&['SCHEDULED','LIVE'].includes(auction.status)&&auction.publishedAt<=now&&!!auction.startsAt&&!!auction.endsAt&&auction.startsAt<=now&&now<auction.endsAt&&(!auction.isDemo||demoBidAllowed(raw)||auction.isSettlementFixture&&stagingDemoUser(userId,raw)),
      serverNow:now.toISOString(),isDemo:auction.isDemo,
      terms:{version:fee.version,ruleVersion:terms.ruleVersion,minParticipants:terms.minParticipants,minPoints:terms.minPoints.toString(),maxPoints:terms.maxPoints?.toString()??null,stepPoints:terms.stepPoints.toString(),entryFeePoints:fee.feePoints.toString(),maxDistinctBids:terms.maxDistinctBids},
      wallet:{available:(wallet?.accounts.find(account=>account.kind==='AVAILABLE')?.balance??0n).toString(),held:(wallet?.accounts.find(account=>account.kind==='HELD')?.balance??0n).toString()},
      previousMax:previousMax.toString(),remainingSubmissions:Math.max(0,terms.maxDistinctBids-bids.length),
      ownBids:bids.map(bid=>({id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString()}))};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
