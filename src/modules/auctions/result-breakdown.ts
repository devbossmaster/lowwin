import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {publicAuctionSelect,publicWhere,toPublicAuction} from './catalog';
import {contactBotId,decryptPhone} from '@/modules/auth/own-contact';
import {finalizedDemoFilter} from './staging-demo';

export const breakdownQuery=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),sort:z.enum(['amount','picked']).default('amount'),amount:z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/).optional(),jump:z.literal('winner').optional()}).strict();
type Query=z.infer<typeof breakdownQuery>;
type Contact={botId:string;phoneCipher:string;revokedAt:Date|null};
type Totals={bids:number;players:number;amounts:number;fees:number};
type Group={amount:string;bid_count:number;players:number};

/** Keep the country prefix and replace exactly the middle three national digits. */
export function maskResultPhone(value:string):string|null{
 if(!/^\+[1-9]\d{7,14}$/.test(value))return null;
 const prefix=value.startsWith('+251')?'+251':'+',digits=value.slice(prefix.length),at=Math.floor((digits.length-3)/2);
 return prefix+digits.slice(0,at)+'***'+digits.slice(at+3);
}
function maskedContact(contact:Contact|null|undefined){
 if(!contact||contact.revokedAt)return null;
 try{if(contact.botId!==contactBotId())return null;return maskResultPhone(decryptPhone(contact.phoneCipher,contact.botId))}catch{return null}
}

/** All queries share the committed cutoff snapshot. No live fallback and no raw participant DTO. */
export async function getResultBreakdown(client:PrismaClient,code:string,input:Query){
 if(!/^[A-Za-z0-9-]{1,120}$/.test(code))return null;
 const query=breakdownQuery.parse(input);
 return client.$transaction(async tx=>{
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const numeric=/^[1-9]\d*$/.test(code)&&Number.isSafeInteger(Number(code))?Number(code):null;
  const row=await tx.auction.findFirst({where:{AND:[publicWhere(now),finalizedDemoFilter(),{status:{in:['CLOSED','CANCELLED']},settlement:{is:{completedAt:{lte:now}}}},{OR:[{code},...(numeric?[{publicCode:numeric}]:[])]}]},select:{...publicAuctionSelect,id:true,settlement:{select:{...publicAuctionSelect.settlement.select,cutoff:true,acceptanceCutoff:true,acceptedCount:true,winningBid:{select:{feePoints:true}},winner:{select:{ownContact:{select:{lastFour:true,botId:true,phoneCipher:true,revokedAt:true}}}}}}}});
  if(!row?.settlement?.publication||row.settlement.publication.publishedAt>now)return null;
  const settlement=row.settlement,filter=Prisma.sql`"auctionId"=${row.id} AND "acceptedAt"<${settlement.cutoff}${settlement.acceptanceCutoff===null?Prisma.empty:Prisma.sql` AND "acceptanceOrder"<=${settlement.acceptanceCutoff}`}`;
  const [totals]=await tx.$queryRaw<Totals[]>(Prisma.sql`SELECT count(*)::int AS bids,count(DISTINCT "userId")::int AS players,count(DISTINCT amount)::int AS amounts,count(DISTINCT "feePoints")::int AS fees FROM "Bid" WHERE ${filter}`);
  if(totals.bids!==settlement.acceptedCount)throw Error('Final result count mismatch');
  const auction=toPublicAuction(row,now);
  if(auction.result)auction.result.winnerPhoneMasked=maskedContact(settlement.winner?.ownContact);
  const metadata={auction,announcedAt:settlement.publication!.publishedAt.toISOString(),entryFee:settlement.winningBid?.feePoints.toString()??row.terms!.entryFeePoints.toString(),variableFees:totals.fees>1,totalBids:totals.bids,totalPlayers:totals.players,totalAmounts:totals.amounts,pageSize:20 as const};
  if(query.amount!==undefined){
   const amount=new Prisma.Decimal(query.amount);
   const [count]=await tx.$queryRaw<{bids:number;players:number}[]>(Prisma.sql`SELECT count(*)::int AS bids,count(DISTINCT "userId")::int AS players FROM "Bid" WHERE ${filter} AND amount=${amount}`);
   if(!count.bids)return null;
   const people=await tx.bid.findMany({where:{auctionId:row.id,acceptedAt:{lt:settlement.cutoff},...(settlement.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:settlement.acceptanceCutoff}}),amount},orderBy:[{acceptedAt:'asc'},{id:'asc'}],skip:(query.page-1)*20,take:20,select:{acceptedAt:true,user:{select:{ownContact:{select:{botId:true,phoneCipher:true,revokedAt:true}}}}}});
   return {...metadata,kind:'participants' as const,amount:amount.toString(),bidCount:count.bids,playerCount:count.players,unique:count.bids===1,winner:settlement.winningPoints?.eq(amount)??false,page:query.page,totalPages:Math.ceil(count.bids/20),participants:people.map(person=>({phoneMasked:maskedContact(person.user.ownContact),submittedAt:person.acceptedAt.toISOString()}))};
  }
  const order=query.sort==='picked'?Prisma.sql`bid_count DESC,grouped.amount ASC`:Prisma.sql`grouped.amount ASC`;
  const groups=Prisma.sql`SELECT amount,count(*)::int AS bid_count,count(DISTINCT "userId")::int AS players FROM "Bid" WHERE ${filter} GROUP BY amount`;
  let page=query.page;
  if(query.jump==='winner'&&settlement.winningPoints){
   const [rank]=await tx.$queryRaw<{position:number}[]>(Prisma.sql`WITH grouped AS (${groups}),ranked AS (SELECT amount,(row_number() OVER (ORDER BY ${order}))::int AS position FROM grouped) SELECT position FROM ranked WHERE amount=${settlement.winningPoints}`);
   if(rank)page=Math.floor((rank.position-1)/20)+1;
  }
  const rows=await tx.$queryRaw<Group[]>(Prisma.sql`WITH grouped AS (${groups}) SELECT amount::text,bid_count,players FROM grouped ORDER BY ${order} LIMIT 20 OFFSET ${(page-1)*20}`);
  return {...metadata,kind:'amounts' as const,sort:query.sort,page,totalPages:Math.ceil(totals.amounts/20),amounts:rows.map(group=>({amount:new Prisma.Decimal(group.amount).toString(),bidCount:group.bid_count,playerCount:group.players,unique:group.bid_count===1,winner:settlement.winningPoints?.eq(group.amount)??false}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:20000});
}
export type ResultBreakdown=NonNullable<Awaited<ReturnType<typeof getResultBreakdown>>>;
