import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {RULE_V5} from './rules';

/** Decision is one grouped database snapshot under the auction lock. Refund
 * intents commit with it; bounded workers move money afterwards. */
export async function settleV5(tx:Prisma.TransactionClient,auction:Prisma.AuctionGetPayload<{include:{terms:true;result:true}}>,now:Date,cancellation:{actor:{id:string};reason:string;key:string}|null,requestHash:string|null){
 const where={auctionId:auction.id,acceptedAt:{lt:auction.endsAt!}};
 const [groups,totals,participants]=await Promise.all([
  tx.bid.groupBy({by:['amount'],where,_count:{_all:true},orderBy:{amount:'asc'}}),
  tx.bid.aggregate({where,_count:{_all:true,acceptanceOrder:true},_max:{acceptanceOrder:true},_min:{acceptanceOrder:true}}),
  tx.$queryRaw<Array<{count:bigint}>>`SELECT count(DISTINCT "userId") AS count FROM "Bid" WHERE "auctionId"=${auction.id} AND "acceptedAt"<(${auction.endsAt!} AT TIME ZONE 'UTC')`,
 ]);
 const count=totals._count._all,participantCount=Number(participants[0].count),unique=groups.find(g=>g._count._all===1);
 // Legacy accepted rows keep their original null acceptanceOrder. V5 never
 // uses acceptance order to break a tie, so that fact remains immutable.
 if(count!==auction.acceptedBidCount)throw Error('ACCEPTED_COUNT_MISMATCH');
 const decision=cancellation?'OWNER_CANCELLED':participantCount<auction.terms!.minParticipants?'MINIMUM_PARTICIPANTS':!unique?'NO_UNIQUE_BID':'LOWEST_UNIQUE';
 const cancelled=decision!=='LOWEST_UNIQUE';
 const winner=cancelled?null:await tx.bid.findFirstOrThrow({where:{...where,amount:unique!.amount},select:{id:true,userId:true,amount:true,acceptanceOrder:true}});
 const id=randomUUID(),proof={settlementId:id,ruleVersion:RULE_V5,termsVersion:auction.terms!.version,cutoff:auction.endsAt!.toISOString(),acceptedCount:count,amountFrequencies:groups.map(g=>({amount:g.amount.toString(),count:g._count._all})),outcome:cancelled?'CANCELLED':'WINNER',winner:winner?{userId:winner.userId,bidId:winner.id,amount:winner.amount.toString(),...(winner.acceptanceOrder!==null?{acceptanceOrder:winner.acceptanceOrder.toString()}:{})}:null,minParticipants:auction.terms!.minParticipants,participantCount,acceptanceCutoff:auction.bidSequence.toString(),decision,amountPolicy:{currency:'NONE',minimum:'1',step:'0.01',maxDecimalPlaces:2,maxConsecutive:3},feePolicy:cancelled?'REFUND_NET_PAID_FEES':'KEEP_DISCLOSED_ENTRY_FEES',refundPolicy:'ORIGINAL_FUNDING_V1',references:[],cancellation:cancellation?{actorId:cancellation.actor.id,reason:cancellation.reason,key:cancellation.key}:null};
 await tx.auction.update({where:{id:auction.id},data:{status:cancelled?'CANCELLED':'CLOSED',nextCloseAttemptAt:null,closeErrorCode:null}});
 const settled=await tx.auctionSettlement.create({data:{id,auctionId:auction.id,outcome:proof.outcome,ruleVersion:RULE_V5,termsVersion:auction.terms!.version,cutoff:auction.endsAt!,acceptedCount:count,participantCount,acceptanceCutoff:auction.bidSequence,decision,winnerUserId:winner?.userId,winningBidId:winner?.id,winningPoints:winner?.amount,actorId:cancellation?.actor.id,reason:cancellation?.reason??(cancelled?decision:null),key:cancellation?.key,requestHash,proof},include:{movements:true}});
 // Each source bid belongs to this frozen settlement. A late provider payment
 // with no accepted Bid has no refund claim and remains its ordinary credit.
 await tx.$executeRaw`
 WITH funding AS(SELECT "userId",sum(gross-discount-bonus) AS cash,sum(bonus) AS bonus FROM "AuctionBidFunding" WHERE "auctionId"=${auction.id} AND "acceptedAt"<(${auction.endsAt!} AT TIME ZONE 'UTC') GROUP BY "userId")
 INSERT INTO "AuctionRefund" (id,"settlementId","userId","cashPoints","bonusPoints","holdPoints",status)
 SELECT gen_random_uuid()::text,${id},u."userId",
  CASE WHEN ${cancelled} THEN COALESCE(f.cash,0) ELSE 0 END,
  CASE WHEN ${cancelled} THEN COALESCE(f.bonus,0) ELSE 0 END,
  COALESCE(h.points,0),'PENDING'
 FROM (SELECT DISTINCT "userId" FROM "Bid" WHERE "auctionId"=${auction.id}
  UNION SELECT w."userId" FROM "AuctionHold" ah JOIN "Wallet" w ON w.id=ah."walletId" WHERE ah."auctionId"=${auction.id} AND ah.points>0) u
 LEFT JOIN funding f ON f."userId"=u."userId"
 LEFT JOIN LATERAL (SELECT ah.points FROM "AuctionHold" ah JOIN "Wallet" w ON w.id=ah."walletId" WHERE ah."auctionId"=${auction.id} AND w."userId"=u."userId") h ON true
 ON CONFLICT ("settlementId","userId") DO NOTHING`;
 return settled;
}
