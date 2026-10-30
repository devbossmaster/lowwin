import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient,type AuctionSettlement} from '@prisma/client';
import {z} from 'zod';
import {AdminError} from './errors';
import {RULE_V1} from '../auctions/rules';

export const resultPublishSchema=z.object({key:z.string().uuid(),auctionId:z.string().uuid(),settlementId:z.string().uuid(),proofHash:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true),confirmation:z.literal('PUBLISH'),reason:z.string().trim().min(5).max(500)}).strict();
const reviewSettlementSelect={id:true,auctionId:true,outcome:true,ruleVersion:true,termsVersion:true,cutoff:true,completedAt:true,acceptedCount:true,decision:true,acceptanceCutoff:true,winnerUserId:true,winningBidId:true,winningPoints:true} as const;
type ReviewSettlement=Pick<AuctionSettlement,keyof typeof reviewSettlementSelect>;
/** Bind approval to immutable decision fields without loading the potentially
 * large financial proof/participant JSON into the publication transaction. */
export function settlementProofHash(s:ReviewSettlement){return createHash('sha256').update(JSON.stringify({id:s.id,auctionId:s.auctionId,outcome:s.outcome,ruleVersion:s.ruleVersion,termsVersion:s.termsVersion,cutoff:s.cutoff.toISOString(),completedAt:s.completedAt.toISOString(),acceptedCount:s.acceptedCount,decision:s.decision,acceptanceCutoff:s.acceptanceCutoff?.toString()??null,winnerUserId:s.winnerUserId,winningBidId:s.winningBidId,winningPoints:s.winningPoints?.toString()??null})).digest('hex')}

export function readResultReview(client:PrismaClient,auctionId:string,page:number){
 z.string().uuid().parse(auctionId);
 return client.$transaction(async tx=>{
  const settlement=await tx.auctionSettlement.findUnique({where:{auctionId},select:{...reviewSettlementSelect,publication:true,winner:{select:{name:true}},auction:{select:{publicCode:true,isDemo:true,winnerPresentation:{select:{imageId:true,version:true}}}}}});
  if(!settlement)throw new AdminError(409,'This auction has not finished settling.');
  const review=await reviewResult(tx,settlement),where={auctionId,acceptedAt:{lt:settlement.cutoff},...(settlement.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:settlement.acceptanceCutoff}})};
  const bids=await tx.bid.findMany({where,select:{id:true,amount:true,acceptedAt:true,acceptanceOrder:true,user:{select:{id:true,name:true}}},orderBy:[{amount:'asc'},{acceptanceOrder:'asc'},{id:'asc'}],take:25,skip:(page-1)*25});
  return {auctionId,settlementId:settlement.id,publicCode:settlement.auction.publicCode,proofHash:review.proofHash,frequencies:review.frequencies,frequencyTotal:review.frequencyTotal,frequenciesTruncated:review.frequencyTotal>review.frequencies.length,winningFrequency:review.winningFrequency,ruleVersion:settlement.ruleVersion,decision:settlement.decision,outcome:settlement.outcome,winningPoints:settlement.winningPoints?.toString()??null,winningBidId:settlement.winningBidId,winnerName:settlement.winner?.name??null,completedAt:settlement.completedAt.toISOString(),publishedAt:settlement.publication?.publishedAt.toISOString()??null,isDemo:settlement.auction.isDemo,winnerPhotoId:settlement.auction.winnerPresentation?.imageId??null,winnerPhotoPath:settlement.auction.winnerPresentation?.imageId?`/api/media/${settlement.auction.winnerPresentation.imageId}`:null,winnerPhotoVersion:settlement.auction.winnerPresentation?.version??0,bids:{items:bids.map(bid=>({...bid,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString(),acceptanceOrder:bid.acceptanceOrder?.toString()??null})),page,total:settlement.acceptedCount,totalPages:Math.ceil(settlement.acceptedCount/25)}};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:30000});
}

/** The private immutable proof is checked against accepted bids again at approval.
 * No browser field can supply a winner, amount, decision or financial mutation. */
export async function reviewResult(tx:Prisma.TransactionClient,settlement:ReviewSettlement){
 const where:Prisma.BidWhereInput={auctionId:settlement.auctionId,acceptedAt:{lt:settlement.cutoff},...(settlement.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:settlement.acceptanceCutoff}})};
 const [groups,acceptedCount,unique,lowest]=await Promise.all([
  tx.bid.groupBy({by:['amount'],where,_count:{_all:true},orderBy:{amount:'asc'},take:100}),
  tx.bid.count({where}),
  tx.bid.groupBy({by:['amount'],where,having:{amount:{_count:{equals:1}}},_count:{_all:true},orderBy:{amount:'asc'},take:1}),
  settlement.ruleVersion!==RULE_V1?tx.bid.findFirst({where,orderBy:[{amount:'asc'},{acceptanceOrder:'asc'},{id:'asc'}],select:{amount:true}}):null,
 ]);
 const frequencies=groups.map(row=>({amount:row.amount.toString(),count:row._count._all}));
 if(acceptedCount!==settlement.acceptedCount)throw new AdminError(409,'Accepted bids do not match the immutable settlement. Publication is blocked.');
 if(settlement.outcome!=='CANCELLED'){
  const amount=unique[0]?.amount??lowest?.amount;
  const winner=amount?await tx.bid.findFirst({where:{...where,amount},orderBy:[{acceptanceOrder:'asc'},{id:'asc'}],select:{id:true,userId:true,amount:true}}):null;
  if(winner?(settlement.outcome!=='WINNER'||settlement.winningBidId!==winner.id||settlement.winnerUserId!==winner.userId||!settlement.winningPoints?.eq(winner.amount)):(settlement.outcome!=='NO_WINNER'||settlement.winningBidId!==null||settlement.winnerUserId!==null||settlement.winningPoints!==null))throw new AdminError(409,'The calculated winner does not match the immutable settlement. Publication is blocked.');
 }
 const [{total}]=await tx.$queryRaw<{total:number}[]>`SELECT count(DISTINCT amount)::int AS total FROM "Bid" WHERE "auctionId"=${settlement.auctionId} AND "acceptedAt"<${settlement.cutoff} AND (${settlement.acceptanceCutoff}::bigint IS NULL OR "acceptanceOrder"<=${settlement.acceptanceCutoff})`;
 const winningFrequency=settlement.winningPoints?await tx.bid.count({where:{...where,amount:settlement.winningPoints}}):null;
 return {proofHash:settlementProofHash(settlement),frequencies,frequencyTotal:total,winningFrequency};
}

/** Caller authenticates and locks Auction before staff, then calls this in the
 * audited command transaction. The auction lock serializes competing approvals. */
export async function publishResult(tx:Prisma.TransactionClient,actor:{id:string;role:string;now:Date},input:z.infer<typeof resultPublishSchema>){
 if(actor.role!=='OWNER')throw new AdminError(403,'Only an approved administrator can publish results.');
 const settlement=await tx.auctionSettlement.findUnique({where:{auctionId:input.auctionId},select:{...reviewSettlementSelect,publication:true,auction:{select:{status:true,publishedAt:true,testRunId:true}}}});
 if(!settlement||settlement.id!==input.settlementId||!['CLOSED','CANCELLED'].includes(settlement.auction.status)||!settlement.auction.publishedAt||settlement.auction.publishedAt>actor.now)throw new AdminError(409,'A completed settlement is required. Refresh the review.');
 if(settlement.publication)return {auctionId:input.auctionId,settlementId:settlement.id,publishedAt:settlement.publication.publishedAt.toISOString(),alreadyPublished:true};
 if(settlement.completedAt>actor.now)throw new AdminError(409,'Settlement is not ready for publication.');
 const review=await reviewResult(tx,settlement);
 if(review.proofHash!==input.proofHash)throw new AdminError(409,'Result review changed. Refresh before publishing.');
 const published=await tx.resultPublication.create({data:{settlementId:settlement.id,actorId:actor.id,proofHash:review.proofHash,reason:input.reason}});
 // Financial settlement is already committed. Approval creates announcement
 // intents only, using the existing globally unique keys for retry safety.
 if(settlement.outcome!=='CANCELLED'){
  const rows=[{key:`settlement:${settlement.id}:completed`,kind:'AUCTION_FINALIZED',payload:{auctionId:input.auctionId,settlementId:settlement.id,outcome:settlement.outcome}},{key:`settlement:${settlement.id}:participants`,kind:'AUCTION_PARTICIPANTS',payload:{auctionId:input.auctionId,settlementId:settlement.id}}];
  await tx.outbox.createMany({data:rows.map(row=>({...row,settlementId:settlement.id,testRunId:settlement.auction.testRunId})),skipDuplicates:true});
 }
 return {auctionId:input.auctionId,settlementId:settlement.id,publishedAt:published.publishedAt.toISOString(),alreadyPublished:false};
}
