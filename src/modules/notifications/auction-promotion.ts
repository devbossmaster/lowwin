import type {Prisma} from '@prisma/client';

/** Matches public bidding: a started SCHEDULED auction is already live. The
 * worker does not need to have changed its stored status before promotion. */
export type PromotionAuction={status:string;publicCode:number|null;slug?:string|null;publishedAt:Date|null;startsAt:Date|null;endsAt:Date|null;isDemo:boolean;testRunId:string|null;settlement:unknown;result:unknown;category?:{visible:boolean}|null;product:{visible:boolean;category?:{visible:boolean}|null}|null};
export function auctionPromotionIssue(a:PromotionAuction|null,now:Date){
 if(!a)return 'Auction not found.';
 if(a.isDemo||a.testRunId)return 'Demo and test auctions cannot be broadcast to players.';
 if(a.settlement||a.result||!['SCHEDULED','LIVE'].includes(a.status))return 'This auction has ended or been settled.';
 if(!a.publishedAt||a.publishedAt>now||a.publicCode===null||a.publicCode<1||a.slug===null)return 'Publish this auction before broadcasting it.';
 if(!a.product?.visible||a.product.category?.visible===false||a.category?.visible===false)return 'This auction or its category is hidden from players.';
 if(!a.startsAt||a.startsAt>now)return 'This auction has not started yet.';
 if(!a.endsAt||a.endsAt<=now)return 'The bidding deadline has passed.';
 return null;
}
export async function promotionNow(tx:Prisma.TransactionClient){
 const [stamp]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 return stamp.now;
}
export async function readAuctionPromotion(tx:Prisma.TransactionClient,auctionId:string,at?:Date){
 const now=at??await promotionNow(tx);
 const auction=await tx.auction.findUnique({where:{id:auctionId},select:{id:true,slug:true,publicCode:true,status:true,startsAt:true,endsAt:true,publishedAt:true,isDemo:true,testRunId:true,presentation:true,category:{select:{visible:true}},settlement:{select:{id:true}},result:{select:{id:true}},product:{select:{title:true,titleAm:true,visible:true,category:{select:{visible:true}},images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}}}});
 return {auction,now,issue:auctionPromotionIssue(auction,now)};
}
