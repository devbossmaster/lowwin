import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {publicAuctionSelect,publicWhere,toPublicAuction} from './catalog';
import {maskedResultContact} from './result-identity';
export {maskResultPhone} from './result-identity';
import {finalizedDemoFilter} from './staging-demo';

export const breakdownQuery=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),sort:z.enum(['amount','picked']).default('amount'),amount:z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/).optional(),jump:z.literal('winner').optional()}).strict();
type Query=z.infer<typeof breakdownQuery>;
type Totals={bids:number;players:number;amounts:number;unique_amounts:number;fees:number};
type Group={amount:string;bid_count:number;players:number};


/** All queries share the committed cutoff snapshot. No live fallback and no raw participant DTO. */
export async function getResultBreakdown(client:PrismaClient,code:string,input:Query){
 if(!/^[A-Za-z0-9-]{1,120}$/.test(code))return null;
 const query=breakdownQuery.parse(input);
 return client.$transaction(async tx=>{
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const numeric=/^[1-9]\d*$/.test(code)&&Number.isSafeInteger(Number(code))?Number(code):null;
  const row=await tx.auction.findFirst({where:{AND:[publicWhere(now),finalizedDemoFilter(),{status:{in:['CLOSED','CANCELLED']},settlement:{is:{completedAt:{lte:now}}}},{OR:[{code},...(numeric?[{publicCode:numeric}]:[])]}]},select:{...publicAuctionSelect,id:true,settlement:{select:{...publicAuctionSelect.settlement.select,cutoff:true,acceptanceCutoff:true,acceptedCount:true,winningBid:{select:{feePoints:true}}}}}});
  if(!row?.settlement?.publication||row.settlement.publication.publishedAt>now)return null;
  const settlement=row.settlement,filter=Prisma.sql`"auctionId"=${row.id} AND "acceptedAt"<${settlement.cutoff}${settlement.acceptanceCutoff===null?Prisma.empty:Prisma.sql` AND "acceptanceOrder"<=${settlement.acceptanceCutoff}`}`;
  const groups=Prisma.sql`SELECT amount,count(*)::int AS bid_count,count(DISTINCT "userId")::int AS players FROM "Bid" WHERE ${filter} GROUP BY amount`;
  const summary=Prisma.sql`count(*)::int AS bids,count(DISTINCT "userId")::int AS players,count(DISTINCT "feePoints")::int AS fees`;
  const numberCounts=Prisma.sql`SELECT count(*)::int AS amounts,count(*) FILTER (WHERE bid_count=1)::int AS unique_amounts FROM grouped`;
  const metadata=(totals:Totals)=>{
   if(totals.bids!==settlement.acceptedCount)throw Error('Final result count mismatch');
   return {auction:toPublicAuction(row,now),announcedAt:settlement.publication!.publishedAt.toISOString(),entryFee:settlement.winningBid?.feePoints.toString()??row.terms!.entryFeePoints.toString(),variableFees:totals.fees>1,totalBids:totals.bids,totalPlayers:totals.players,totalAmounts:totals.amounts,totalUniqueAmounts:totals.unique_amounts,pageSize:20 as const};
  };
  if(query.amount!==undefined){
   const amount=new Prisma.Decimal(query.amount);
   const [totals]=await tx.$queryRaw<(Totals&{amount_bids:number;amount_players:number})[]>(Prisma.sql`
    WITH grouped AS (${groups}), summary AS (
     SELECT ${summary},count(*) FILTER (WHERE amount=${amount})::int AS amount_bids,
      count(DISTINCT "userId") FILTER (WHERE amount=${amount})::int AS amount_players FROM "Bid" WHERE ${filter}
    )
    SELECT summary.*,numbers.* FROM summary CROSS JOIN (${numberCounts}) numbers`);
   const details=metadata(totals);
   if(!totals.amount_bids)return null;
   const people=await tx.bid.findMany({where:{auctionId:row.id,acceptedAt:{lt:settlement.cutoff},...(settlement.acceptanceCutoff===null?{}:{acceptanceOrder:{lte:settlement.acceptanceCutoff}}),amount},orderBy:[{acceptanceOrder:'asc'},{id:'asc'}],skip:(query.page-1)*20,take:20,select:{acceptedAt:true,user:{select:{ownContact:{select:{botId:true,phoneCipher:true,revokedAt:true}}}}}});
   return {...details,kind:'participants' as const,amount:amount.toString(),bidCount:totals.amount_bids,playerCount:totals.amount_players,unique:totals.amount_bids===1,winner:settlement.winningPoints?.eq(amount)??false,page:query.page,totalPages:Math.ceil(totals.amount_bids/20),participants:people.map(person=>({phoneMasked:maskedResultContact(person.user.ownContact),submittedAt:person.acceptedAt.toISOString()}))};
  }
  const order=query.sort==='picked'?Prisma.sql`bid_count DESC,grouped.amount ASC`:Prisma.sql`grouped.amount ASC`;
  const selectedPage=query.jump==='winner'&&settlement.winningPoints
   ?Prisma.sql`coalesce((SELECT ((position-1)/20+1)::int FROM (SELECT amount,row_number() OVER (ORDER BY ${order}) AS position FROM grouped) ranked WHERE amount=${settlement.winningPoints}),${query.page}::int)`
   :Prisma.sql`${query.page}::int`;
  const [totals]=await tx.$queryRaw<(Totals&{page:number;rows:Group[]})[]>(Prisma.sql`
   WITH grouped AS MATERIALIZED (${groups}), summary AS (SELECT ${summary} FROM "Bid" WHERE ${filter}),
    selected_page AS (SELECT ${selectedPage} AS page),
    page_amounts AS (SELECT * FROM grouped ORDER BY ${order} LIMIT 20 OFFSET ((SELECT page FROM selected_page)-1)*20)
   SELECT summary.*,numbers.*,selected_page.page,
    coalesce((SELECT jsonb_agg(jsonb_build_object('amount',grouped.amount::text,'bid_count',bid_count,'players',players) ORDER BY ${order}) FROM page_amounts grouped),'[]'::jsonb) AS rows
   FROM summary CROSS JOIN (${numberCounts}) numbers CROSS JOIN selected_page`);
  return {...metadata(totals),kind:'amounts' as const,sort:query.sort,page:totals.page,totalPages:Math.ceil(totals.amounts/20),amounts:totals.rows.map(group=>({amount:new Prisma.Decimal(group.amount).toString(),bidCount:group.bid_count,playerCount:group.players,unique:group.bid_count===1,winner:settlement.winningPoints?.eq(group.amount)??false}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:20000});
}
export type ResultBreakdown=NonNullable<Awaited<ReturnType<typeof getResultBreakdown>>>;
