import {isSubmissionFeeOnly} from '../auctions/rules';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicAuctionSelect,publicWhere,toPublicAuction } from '../auctions/catalog';
import { PrivateApiError } from '../auth/private-api';

export const displayProfileSchema=z.object({displayName:z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}]+$/u),bio:z.string().trim().max(160).regex(/^[^\p{Cc}\p{Cf}]*$/u)}).strict();
export const pageSchema=z.coerce.number().int().min(1).max(1000).default(1);
export const personalQuerySchema=z.object({view:z.enum(['all','live','history']).default('all'),page:pageSchema}).strict();
const liveWhere=(now:Date):Prisma.AuctionWhereInput=>({status:{in:['LIVE','SCHEDULED']},endsAt:{gt:now},settlement:{is:null}});
const ownAuctionSelect={terms:{select:{ruleVersion:true}},code:true,publicCode:true,publicViewCount:true,slug:true,status:true,endsAt:true,isDemo:true,product:{select:{title:true,titleAm:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true,alt:true}}}},settlement:{select:{decision:true,outcome:true,winningBidId:true,completedAt:true}}} satisfies Prisma.AuctionSelect;
export async function getPersonalBids(client:PrismaClient,userId:string,input:unknown={}) {
  const query=personalQuerySchema.parse(input);
  return client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const where:Prisma.BidWhereInput={userId,...(query.view==='all'?{}:{auction:query.view==='live'?liveWhere(now):{NOT:liveWhere(now)}})};
    const [rows,total,live,all]=await Promise.all([
      tx.bid.findMany({where,orderBy:[{acceptedAt:'desc'},{id:'desc'}],skip:(query.page-1)*20,take:20,select:{id:true,amount:true,acceptedAt:true,feePoints:true,auction:{select:ownAuctionSelect}}}),tx.bid.count({where}),tx.bid.count({where:{userId,auction:liveWhere(now)}}),tx.bid.count({where:{userId}}),
    ]);
    return {items:rows.map(bid=>{
      const result=bid.auction.settlement;
      const outcome=result?(result.outcome==='WINNER'?(result.winningBidId===bid.id?'WON':'LOST'):result.outcome):bid.auction.endsAt&&bid.auction.endsAt<=now?'PENDING':'LIVE';
      return {id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString(),feePoints:bid.feePoints.toString(),outcome,decision:result?.decision??null,feeRefunded:result?.outcome==='CANCELLED'&&!isSubmissionFeeOnly(bid.auction.terms?.ruleVersion)?bid.feePoints.toString():'0',closedAt:result?.completedAt.toISOString()??null,auction:{ruleVersion:bid.auction.terms?.ruleVersion,code:bid.auction.publicCode.toString(),slug:bid.auction.slug,title:bid.auction.product?.title??bid.auction.publicCode.toString(),titleAm:bid.auction.product?.titleAm??null,image:bid.auction.product?.images[0]??null,endsAt:bid.auction.endsAt?.toISOString()??null,isDemo:bid.auction.isDemo,views:bid.auction.publicViewCount.toString()}};
    }),page:query.page,total,totalPages:Math.ceil(total/20),counts:{live,history:all-live}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export async function getPlayerProfile(client:PrismaClient,userId:string) {
  return client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const [user,wallet,bids,liveBids,wins,favorites]=await Promise.all([
      tx.user.findUniqueOrThrow({where:{id:userId},select:{name:true,playerProfile:{select:{displayName:true,bio:true}}}}),
      tx.wallet.findUnique({where:{userId},select:{accounts:{select:{kind:true,balance:true}}}}),
      tx.bid.count({where:{userId}}),tx.bid.count({where:{userId,auction:liveWhere(now)}}),
      tx.auctionSettlement.count({where:{winnerUserId:userId,outcome:'WINNER'}}),
      tx.auctionFavorite.count({where:{userId,auction:publicWhere(now)}}),
    ]);
    return {displayName:user.playerProfile?.displayName??user.name,bio:user.playerProfile?.bio??'',counts:{bids,liveBids,historyBids:bids-liveBids,wins,favorites},wallet:{available:wallet?.accounts.find(a=>a.kind==='AVAILABLE')?.balance.toString()??'0',held:wallet?.accounts.find(a=>a.kind==='HELD')?.balance.toString()??'0'}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export async function editPlayerProfile(client:PrismaClient,userId:string,input:unknown) {
  const fields=displayProfileSchema.parse(input);
  return client.playerProfile.upsert({where:{userId},create:{userId,...fields},update:fields,select:{displayName:true,bio:true}});
}
export async function getPersonalWins(client:PrismaClient,userId:string,page=1) {
  page=pageSchema.parse(page);
  const where={winnerUserId:userId,outcome:'WINNER' as const};
  const [rows,total]=await client.$transaction([
    client.auctionSettlement.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],skip:(page-1)*6,take:6,select:{ruleVersion:true,decision:true,auctionId:true,winningBidId:true,winningPoints:true,completedAt:true,auction:{select:{code:true,publicCode:true,publicViewCount:true,slug:true,isDemo:true,product:{select:{title:true,titleAm:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true,alt:true}}}}}}}}),client.auctionSettlement.count({where}),
  ]);
  return {items:rows.map(row=>({ruleVersion:row.ruleVersion,decision:row.decision,auctionId:row.auctionId,bidId:row.winningBidId,views:row.auction.publicViewCount.toString(),titleAm:row.auction.product?.titleAm??null,code:row.auction.publicCode.toString(),slug:row.auction.slug,title:row.auction.product?.title??row.auction.publicCode.toString(),image:row.auction.product?.images[0]??null,isDemo:row.auction.isDemo,winningPoints:row.winningPoints!.toString(),closedAt:row.completedAt.toISOString(),fulfillment:'Pending',fulfillmentNote:row.auction.isDemo?'DEMO test; no real prize or dispatch.':'Fulfillment has not started. No shipment is recorded.'})),page,total,totalPages:Math.ceil(total/6)};
}
export async function getFavorites(client:PrismaClient,userId:string,page=1) {
  page=pageSchema.parse(page);
  const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const where={userId,auction:publicWhere(now)};
  const [rows,total]=await client.$transaction([
    client.auctionFavorite.findMany({where,orderBy:[{createdAt:'desc'},{auctionId:'asc'}],skip:(page-1)*6,take:6,select:{auction:{select:publicAuctionSelect}}}),client.auctionFavorite.count({where}),
  ]);
  return {items:rows.map(row=>toPublicAuction(row.auction,now)),page,total,totalPages:Math.ceil(total/6),serverNow:now.toISOString()};
}
export async function favoriteState(client:PrismaClient,userId:string,slug:string,saved?:boolean) {
  if(!/^[a-z0-9-]{1,120}$/.test(slug))throw new PrivateApiError(404,'Auction not found.');
  const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const auction=await client.auction.findFirst({where:{AND:[publicWhere(now),{slug}]},select:{id:true}});
  if(!auction)throw new PrivateApiError(404,'Auction not found.');
  const key={userId,auctionId:auction.id};
  if(saved===true)await client.auctionFavorite.upsert({where:{userId_auctionId:key},create:key,update:{}});
  if(saved===false)await client.auctionFavorite.deleteMany({where:key});
  return {saved:saved??!!(await client.auctionFavorite.findUnique({where:{userId_auctionId:key},select:{auctionId:true}}))};
}
