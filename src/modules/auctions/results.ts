import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicAuctionSelect, publicWhere, toPublicAuction } from './catalog';

export const resultQuerySchema=z.object({q:z.string().trim().max(80).default(''),category:z.string().regex(/^[a-z0-9-]{0,80}$/).default(''),sort:z.enum(['newest','oldest','title']).default('newest'),status:z.enum(['all','winner','no_winner','cancelled','pending']).default('all'),page:z.coerce.number().int().min(1).max(1000).default(1)}).strict();
type ResultQuery=z.infer<typeof resultQuerySchema>;
function outcomeWhere(status:ResultQuery['status'],now:Date):Prisma.AuctionWhereInput {
  if(status==='pending')return {status:{in:['LIVE','SCHEDULED']},settlement:{is:null},result:{is:null},endsAt:{lte:now}};
  if(status==='all')return {OR:[{settlement:{isNot:null}},{result:{is:{publishedAt:{lte:now}}}},{endsAt:{lte:now}}]};
  const outcome=status.toUpperCase() as 'WINNER'|'NO_WINNER'|'CANCELLED';
  return {OR:[{settlement:{is:{outcome}}},{result:{is:{outcome,publishedAt:{lte:now}}}}]};
}
export async function listPublicResults(client:PrismaClient,input:Partial<ResultQuery>={}) {
  const query=resultQuerySchema.parse(input);
  return client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const base:Prisma.AuctionWhereInput={AND:[publicWhere(now),query.q?{OR:[{code:{contains:query.q,mode:'insensitive'}},{product:{is:{title:{contains:query.q,mode:'insensitive'}}}}]}:{}]};
    if(query.category)(base.AND as Prisma.AuctionWhereInput[]).push({category:{is:{slug:query.category}}});
    const where={AND:[base,outcomeWhere(query.status,now)]};
    const [rows,total]=await Promise.all([
      tx.auction.findMany({where,select:publicAuctionSelect,orderBy:query.sort==='title'?[{product:{title:'asc'}},{id:'asc'}]:[{endsAt:query.sort==='oldest'?'asc':'desc'},{id:'asc'}],skip:(query.page-1)*6,take:6}),
      tx.auction.count({where}),
    ]);
    return {items:rows.map(row=>toPublicAuction(row,now)),total,page:query.page,totalPages:Math.ceil(total/6),serverNow:now.toISOString()};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:30000});
}
export async function getPublicResult(client:PrismaClient,code:string) {
  if(!/^[A-Za-z0-9-]{1,120}$/.test(code))return null;
  const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const row=await client.auction.findFirst({where:{AND:[publicWhere(now),outcomeWhere('all',now),{code}]},select:publicAuctionSelect});
  return row?toPublicAuction(row,now):null;
}
