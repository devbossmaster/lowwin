import {Prisma,type PrismaClient} from '@prisma/client';
import {adjustAuctionHoldInTransaction} from '../wallet/holds';
import {RULE_V3,RULE_V4,V4_NUMBER_TERMS,V4_CANCELLATION_TERMS,V2_FALLBACK_TERMS} from './rules';

/** Operator-only migration, deliberately not exposed as an HTTP command.
 * Requires the database table owner. Trigger changes and ledger entries are atomic.
 * Accepted bid receipts are preserved; old bid holds are released, not deleted.
 */
export async function adoptSubmissionFee(client:PrismaClient,code:string,fee:string,apply=false){
 if(!/^(0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(fee))throw Error('Provide a non-negative submission fee with at most two decimals.');
 return client.$transaction(async tx=>{
  if(apply){
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
   await tx.$executeRawUnsafe('LOCK TABLE "Auction" IN EXCLUSIVE MODE');
  }
  const a=await tx.auction.findUnique({where:{code},include:{terms:true,feeRevisions:{orderBy:{version:'desc'},take:1},settlement:true,result:true,holds:{include:{wallet:true}}}});
  if(!a?.terms||!a.publishedAt||a.settlement||a.result||!['LIVE','SCHEDULED'].includes(a.status))throw Error('Choose an unfinished published auction by its exact LW code.');
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  if(!a.endsAt||a.endsAt<=now)throw Error('This auction has ended. It cannot adopt new bidding rules.');
  if(a.terms.ruleVersion===RULE_V4)throw Error('This auction already uses submission fees only. Change its fee in the admin panel.');
  if(a.terms.ruleVersion!==RULE_V3)throw Error('Only decimal V3 auctions can be converted by this command.');
  const current=a.feeRevisions[0];if(!current)throw Error('Missing fee revision.');
  const released=a.holds.reduce((sum,h)=>sum.add(h.points),new Prisma.Decimal(0)).toString();
  const report={auctionCode:a.code,acceptedBids:a.acceptedBidCount,oldRule:a.terms.ruleVersion,newRule:RULE_V4,submissionFee:fee,heldEtbToRelease:released,feeRefund:'0',nonRefundableOnCancellation:true,applied:apply};
  if(!apply)return report;
  for(const hold of [...a.holds].sort((x,y)=>x.wallet.userId<y.wallet.userId?-1:1)){
   if(hold.points.gt(0))await adjustAuctionHoldInTransaction(tx,{userId:hold.wallet.userId,auctionId:a.id,direction:'RELEASE',points:hold.points.toString(),key:`fee-only:${a.id}`,reference:`fee-only-policy:${a.id}`});
  }
  await tx.$executeRawUnsafe('ALTER TABLE "AuctionTerms" DISABLE TRIGGER immutable_auction_terms');
  await tx.auctionTerms.update({where:{auctionId:a.id},data:{ruleVersion:RULE_V4,maxPoints:null,entryFeePoints:new Prisma.Decimal(fee),noWinnerTerms:V2_FALLBACK_TERMS+' '+V4_NUMBER_TERMS,cancellationTerms:V4_CANCELLATION_TERMS}});
  await tx.$executeRawUnsafe('ALTER TABLE "AuctionTerms" ENABLE TRIGGER immutable_auction_terms');
  const [{changedAt}]=await tx.$queryRaw<{changedAt:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "changedAt"`;
  const operationKey=`fee-only-policy:${a.id}`;
  await tx.auctionFeeRevision.create({data:{auctionId:a.id,version:current.version+1,feePoints:new Prisma.Decimal(fee),effectiveAt:changedAt,reason:'Owner-requested submission-fee-only policy',operationKey}});
  await tx.auctionControlRevision.create({data:{auctionId:a.id,version:a.controlVersion+1,kind:'BIDDING_POLICY',before:{ruleVersion:a.terms.ruleVersion,maxPoints:a.terms.maxPoints?.toString()??null,feePoints:current.feePoints.toString()},after:{ruleVersion:RULE_V4,maxPoints:null,feePoints:fee,heldEtbReleased:released,refundPolicy:'NON_REFUNDABLE_SUBMISSION_FEES'},actorId:'operator:submission-fee-migration',reason:'Owner-requested bid numbers without monetary holds or winning charge; submission fees remain non-refundable.',operationKey}});
  await tx.auction.update({where:{id:a.id},data:{controlVersion:{increment:1}}});
  return report;
 },{maxWait:15000,timeout:120000});
}
