import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {AdminError} from './errors';
import {reviewResult,reviewSettlementSelect} from '../auctions/result-publication';
export {reviewResult,settlementProofHash} from '../auctions/result-publication';
export const resultPublishSchema=z.object({key:z.string().uuid(),auctionId:z.string().uuid(),settlementId:z.string().uuid(),proofHash:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true),confirmation:z.literal('PUBLISH'),reason:z.string().trim().min(5).max(500)}).strict();
export function readResultReview(client:PrismaClient,auctionId:string,page:number){
 z.string().uuid().parse(auctionId);
 return client.$transaction(async tx=>{
  const settlement=await tx.auctionSettlement.findUnique({where:{auctionId},select:{...reviewSettlementSelect,publication:true,winner:{select:{name:true}},auction:{select:{publicCode:true,isDemo:true,winnerPresentation:{select:{imageId:true,version:true,presentationMode:true,bannerImageId:true,bannerConsentConfirmedAt:true,bannerConsentActorId:true}}}}}});
  if(!settlement)throw new AdminError(409,'This auction has not finished settling.');
  const review=await reviewResult(tx,settlement),where={auctionId,acceptedAt:{lt:settlement.cutoff},...(settlement.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:settlement.acceptanceCutoff}})};
  const bids=await tx.bid.findMany({where,select:{id:true,amount:true,acceptedAt:true,acceptanceOrder:true,user:{select:{id:true,name:true}}},orderBy:[{amount:'asc'},{acceptanceOrder:'asc'},{id:'asc'}],take:25,skip:(page-1)*25});
  return {auctionId,settlementId:settlement.id,publicCode:settlement.auction.publicCode,proofHash:review.proofHash,frequencies:review.frequencies,frequencyTotal:review.frequencyTotal,frequenciesTruncated:review.frequencyTotal>review.frequencies.length,winningFrequency:review.winningFrequency,ruleVersion:settlement.ruleVersion,decision:settlement.decision,outcome:settlement.outcome,winningPoints:settlement.winningPoints?.toString()??null,winningBidId:settlement.winningBidId,winnerName:settlement.winner?.name??null,completedAt:settlement.completedAt.toISOString(),publishedAt:settlement.publication?.publishedAt.toISOString()??null,isDemo:settlement.auction.isDemo,winnerPhotoId:settlement.auction.winnerPresentation?.presentationMode==='PHOTO'?settlement.auction.winnerPresentation.imageId:null,winnerPhotoPath:settlement.auction.winnerPresentation?.presentationMode==='PHOTO'&&settlement.auction.winnerPresentation.imageId?`/api/media/${settlement.auction.winnerPresentation.imageId}`:null,winnerPhotoVersion:settlement.auction.winnerPresentation?.version??0,winnerPresentationMode:settlement.auction.winnerPresentation?.presentationMode??'PRODUCT',winnerBannerId:settlement.auction.winnerPresentation?.presentationMode==='BANNER'?settlement.auction.winnerPresentation.bannerImageId:null,winnerBannerPath:settlement.auction.winnerPresentation?.presentationMode==='BANNER'&&settlement.auction.winnerPresentation.bannerImageId?`/api/media/${settlement.auction.winnerPresentation.bannerImageId}`:null,winnerBannerVersion:settlement.auction.winnerPresentation?.version??0,bids:{items:bids.map(bid=>({...bid,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString(),acceptanceOrder:bid.acceptanceOrder?.toString()??null})),page,total:settlement.acceptedCount,totalPages:Math.ceil(settlement.acceptedCount/25)}};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:30000});
}


/** The staff API cannot publish, withhold, unpublish or alter settled results. */
export async function publishResult(..._arguments:unknown[]):Promise<never>{throw new AdminError(410,'Result publication is automatic. Administrators can manage the Winners banner only.')}
