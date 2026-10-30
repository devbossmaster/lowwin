import {isSubmissionFeeOnly} from '../auctions/rules';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicAuctionSelect,publicWhere,toPublicAuction } from '../auctions/catalog';
import { PrivateApiError } from '../auth/private-api';
import {ownProfileContact} from './account-contact';
import {getReferralOverview,referralSchemaReady} from '../referrals/service';

export const displayProfileSchema=z.object({displayName:z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}]+$/u),bio:z.string().trim().max(160).regex(/^[^\p{Cc}\p{Cf}]*$/u),contactEmail:z.string().trim().max(254).refine(value=>value===''||z.email().safeParse(value).success).optional(),city:z.string().trim().max(80).regex(/^[^\p{Cc}\p{Cf}]*$/u).optional()}).strict();
export const pageSchema=z.coerce.number().int().min(1).max(1000).default(1);
export const personalQuerySchema=z.object({view:z.enum(['all','live','history']).default('all'),page:pageSchema}).strict();
const liveWhere=(now:Date):Prisma.AuctionWhereInput=>({status:{in:['LIVE','SCHEDULED']},endsAt:{gt:now},settlement:{is:null}});
const ownAuctionSelect={terms:{select:{ruleVersion:true}},code:true,publicCode:true,publicViewCount:true,slug:true,status:true,endsAt:true,isDemo:true,product:{select:{title:true,titleAm:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true,alt:true}}}},settlement:{select:{publication:{select:{publishedAt:true}},decision:true,outcome:true,winningBidId:true,completedAt:true}}} satisfies Prisma.AuctionSelect;
export async function getPersonalBids(client:PrismaClient,userId:string,input:unknown={}) {
  const query=personalQuerySchema.parse(input);
  return client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const where:Prisma.BidWhereInput={userId,...(query.view==='all'?{}:{auction:query.view==='live'?liveWhere(now):{NOT:liveWhere(now)}})};
    const [rows,[counts]]=await Promise.all([
      tx.bid.findMany({where,orderBy:[{acceptedAt:'desc'},{id:'desc'}],skip:(query.page-1)*20,take:20,select:{id:true,amount:true,acceptedAt:true,feePoints:true,auction:{select:ownAuctionSelect},operation:{select:{journal:{select:{kind:true,postings:{select:{delta:true,account:{select:{kind:true,wallet:{select:{userId:true}}}}}}}}}}}}),
      tx.$queryRaw<{total:number;active:number;won:number}[]>`SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE a.status IN ('LIVE','SCHEDULED') AND a."endsAt">(${now}::timestamptz AT TIME ZONE 'UTC') AND s.id IS NULL))::int AS active,
        (count(*) FILTER (WHERE s.outcome='WINNER' AND s."winningBidId"=b.id AND EXISTS (SELECT 1 FROM "ResultPublication" rp WHERE rp."settlementId"=s.id AND rp."publishedAt"<=${now})))::int AS won
        FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId"
        LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id WHERE b."userId"=${userId}`,
    ]);
    const {total:all,active:live,won}=counts,total=query.view==='all'?all:query.view==='live'?live:all-live;
    // Provider details are optional evidence, never a separate list of attempts.
    // The legacy adapter is additive and may not be installed on an older DB.
    const providers=process.env.ARIFPAY_SCHEMA_READY==='true'&&rows.length?await tx.arifPayCheckout.findMany({where:{userId,bidId:{in:rows.map(bid=>bid.id)},status:'BID_ACCEPTED',creditJournalId:{not:null}},select:{bidId:true,transactionId:true,channel:true,fee:true}}):[];
    const discounts=referralSchemaReady()&&rows.length?await tx.referralRedemption.findMany({where:{userId,bidId:{in:rows.map(bid=>bid.id)}},select:{bidId:true,grossFeePoints:true,discountPoints:true,coupon:{select:{percent:true}}}}):[];
    const chapa=process.env.CHAPA_SCHEMA_READY==='true'&&rows.length?await tx.chapaCheckout.findMany({where:{userId,bidId:{in:rows.map(bid=>bid.id)},status:'BID_ACCEPTED',creditJournalId:{not:null}},select:{id:true,bidId:true,merchantReference:true,paymentMethod:true,amountCents:true}}):[];
    return {items:rows.map(bid=>{
      const result=bid.auction.settlement?.publication&&bid.auction.settlement.publication.publishedAt<=now?bid.auction.settlement:null;
      const outcome=result?(result.outcome==='WINNER'?(result.winningBidId===bid.id?'WON':'LOST'):result.outcome):bid.auction.status==='CANCELLED'?'CANCELLED':bid.auction.status==='CLOSED'||bid.auction.endsAt&&bid.auction.endsAt<=now?'PENDING':'LIVE';
      const journal=bid.operation.journal,paid=bid.feePoints.gt(0)&&journal?.kind==='BID_FEE'&&journal.postings.some(posting=>posting.account.kind==='AVAILABLE'&&posting.account.wallet?.userId===userId&&posting.delta.eq(bid.feePoints.negated()))&&journal.postings.some(posting=>posting.account.kind==='FEES'&&posting.delta.eq(bid.feePoints));
      const provider=providers.find(order=>order.bidId===bid.id&&order.fee.eq(bid.feePoints)&&!!order.transactionId);
      const incoming=chapa.find(order=>order.bidId===bid.id);
      const payment={checkoutId:incoming?.id??null,status:bid.feePoints.isZero()?'NOT_REQUIRED' as const:incoming||paid?'PAID' as const:'UNAVAILABLE' as const,method:incoming?'CHAPA' as const:paid?(provider?(provider.channel==='TELEBIRR'?'ARIFPAY_TELEBIRR' as const:provider.channel==='MPESA'?'ARIFPAY_MPESA' as const:null):'WALLET' as const):null,transactionRef:incoming?incoming.merchantReference:paid&&provider?provider.transactionId:null};
      const redemption=discounts.find(row=>row.bidId===bid.id&&row.grossFeePoints.eq(bid.feePoints));
      const discount=redemption?{points:redemption.discountPoints.toString(),percent:redemption.coupon.percent,netFeePoints:bid.feePoints.sub(redemption.discountPoints).toString()}:null;
      return {id:bid.id,amount:bid.amount.toString(),acceptedAt:bid.acceptedAt.toISOString(),feePoints:bid.feePoints.toString(),payment,discount,outcome,decision:result?.decision??null,feeRefunded:result?.outcome==='CANCELLED'&&!isSubmissionFeeOnly(bid.auction.terms?.ruleVersion)?bid.feePoints.toString():'0',closedAt:result?.completedAt.toISOString()??null,auction:{ruleVersion:bid.auction.terms?.ruleVersion,code:bid.auction.publicCode.toString(),slug:bid.auction.slug,title:bid.auction.product?.title??bid.auction.publicCode.toString(),titleAm:bid.auction.product?.titleAm??null,image:bid.auction.product?.images[0]??null,endsAt:bid.auction.endsAt?.toISOString()??null,isDemo:bid.auction.isDemo,views:bid.auction.publicViewCount.toString()}};
    }),page:query.page,pageSize:20 as const,total,totalPages:Math.ceil(total/20),counts:{total:all,active:live,won,live,history:all-live}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export async function getPlayerProfile(client:PrismaClient,userId:string) {
  const profile=client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const [user,bids,liveBids,wins,favorites]=await Promise.all([
      tx.user.findUniqueOrThrow({where:{id:userId},select:{name:true,playerProfile:{select:{displayName:true,bio:true}}}}),
      tx.bid.count({where:{userId}}),tx.bid.count({where:{userId,auction:liveWhere(now)}}),
      tx.auctionSettlement.count({where:{winnerUserId:userId,outcome:'WINNER',publication:{is:{publishedAt:{lte:now}}}}}),
      tx.auctionFavorite.count({where:{userId,auction:publicWhere(now)}}),
    ]);
    return {displayName:user.playerProfile?.displayName??user.name,bio:user.playerProfile?.bio??'',counts:{bids,liveBids,historyBids:bids-liveBids,wins,favorites}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  const [base,contact,details,referral]=await Promise.all([
    profile,ownProfileContact(client,userId),
    referralSchemaReady()?client.playerProfile.findUnique({where:{userId},select:{contactEmail:true,city:true}}):Promise.resolve(null),
    getReferralOverview(client,userId),
  ]);
  return {...base,...contact,contactEmail:details?.contactEmail??'',city:details?.city??'',contactDetailsEditable:referralSchemaReady(),referral};
}
export async function editPlayerProfile(client:PrismaClient,userId:string,input:unknown) {
  const fields=displayProfileSchema.parse(input);
  const {contactEmail,city,...display}=fields,ready=referralSchemaReady();
  if(!ready&&(contactEmail||city))throw new PrivateApiError(503,'Additional profile details are temporarily unavailable.');
  const update=ready?{...display,...(contactEmail!==undefined?{contactEmail:contactEmail||null}:{}),...(city!==undefined?{city:city||null}:{})}:display;
  return client.playerProfile.upsert({where:{userId},create:{userId,...update},update,select:{displayName:true,bio:true}});
}
export async function getPersonalWins(client:PrismaClient,userId:string,page=1) {
  page=pageSchema.parse(page);
  const where={winnerUserId:userId,outcome:'WINNER' as const,publication:{is:{publishedAt:{lte:new Date()}}}};
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
