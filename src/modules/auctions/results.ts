import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicAuctionSelect, publicWhere, toPublicAuction } from './catalog';
import {cachedPublicData} from '@/modules/cache/public-data';

export const resultQuerySchema=z.object({q:z.string().trim().max(80).default(''),category:z.string().regex(/^[a-z0-9-]{0,80}$/).default(''),sort:z.enum(['newest','oldest','title']).default('newest'),status:z.enum(['all','winner','no_winner','cancelled','pending']).default('all'),page:z.coerce.number().int().min(1).max(1000).default(1),pageSize:z.coerce.number().int().refine(value=>[6,12,24,48,96].includes(value)).default(6)}).strict();
type ResultQuery=z.infer<typeof resultQuerySchema>;
/** Genuine winners only: no examples, pending results or cancellation announcements. */
export function listCompletedWinners(client:PrismaClient,page=1,pageSize=12){
 return cachedPublicData(`completed-winners:${page}:${pageSize}`,5000,()=>client.$transaction(async tx=>{
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const where:Prisma.AuctionWhereInput={AND:[publicWhere(now),{isDemo:false,status:'CLOSED',settlement:{is:{outcome:'WINNER',winningPoints:{not:null},completedAt:{lte:now}}}}]};
  const [rows,total]=await Promise.all([tx.auction.findMany({where,select:publicAuctionSelect,orderBy:[{settlement:{completedAt:'desc'}},{id:'desc'}],take:pageSize,skip:(page-1)*pageSize}),tx.auction.count({where})]);
  return {items:rows.map(row=>{const auction=toPublicAuction(row,now);if(auction.result)auction.result.winnerPhoneMasked=null;return auction}),total,page,totalPages:Math.ceil(total/pageSize),serverNow:now.toISOString()};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:20000}));
}
function outcomeWhere(status:ResultQuery['status'],now:Date):Prisma.AuctionWhereInput {
  if(status==='pending')return {status:{in:['LIVE','SCHEDULED']},settlement:{is:null},result:{is:null},endsAt:{lte:now}};
  if(status==='all')return {OR:[{settlement:{isNot:null}},{result:{is:{publishedAt:{lte:now}}}},{endsAt:{lte:now}}]};
  const outcome=status.toUpperCase() as 'WINNER'|'NO_WINNER'|'CANCELLED';
  return {OR:[{settlement:{is:{outcome}}},{result:{is:{outcome,publishedAt:{lte:now}}}}]};
}
export async function listPublicResults(client:PrismaClient,input:Partial<ResultQuery>={}) {
  const query=resultQuerySchema.parse(input);
  return cachedPublicData(`public-results:${JSON.stringify(query)}`,5000,()=>client.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const searchedPublicCode=/^[1-9]\d*$/.test(query.q)&&Number.isSafeInteger(Number(query.q))?Number(query.q):null;
    const base:Prisma.AuctionWhereInput={AND:[publicWhere(now),query.q?{OR:[{code:{contains:query.q,mode:'insensitive'}},{product:{is:{OR:[{title:{contains:query.q,mode:'insensitive'}},{titleAm:{contains:query.q,mode:'insensitive'}}]}}},{presentation:{path:['title'],string_contains:query.q}},{presentation:{path:['titleAm'],string_contains:query.q}},...(searchedPublicCode?[{publicCode:searchedPublicCode}]:[])]}:{}]};
    if(query.category)(base.AND as Prisma.AuctionWhereInput[]).push({category:{is:{slug:query.category}}});
    const where={AND:[base,outcomeWhere(query.status,now)]};
    const [rows,total]=await Promise.all([
      tx.auction.findMany({where,select:publicAuctionSelect,orderBy:query.sort==='title'?[{product:{title:'asc'}},{id:'asc'}]:[{endsAt:query.sort==='oldest'?'asc':'desc'},{id:'asc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize}),
      tx.auction.count({where}),
    ]);
    return {items:rows.map(row=>toPublicAuction(row,now)),total,page:query.page,pageSize:query.pageSize,totalPages:Math.ceil(total/query.pageSize),serverNow:now.toISOString()};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:30000}));
}
export async function getPublicResult(client:PrismaClient,code:string) {
  if(!/^[A-Za-z0-9-]{1,120}$/.test(code))return null;
  return cachedPublicData(`public-result:${code}`,5000,async()=>{
  const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  const publicCode=/^[1-9]\d*$/.test(code)&&Number.isSafeInteger(Number(code))?Number(code):null;
  const row=await client.auction.findFirst({where:{AND:[publicWhere(now),outcomeWhere('all',now),{OR:[{code},...(publicCode?[{publicCode}]:[])]}]},select:publicAuctionSelect});
  return row?toPublicAuction(row,now):null;
  });
}
