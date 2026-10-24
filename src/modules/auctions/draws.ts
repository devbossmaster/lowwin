import {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {cachedPublicData} from '@/modules/cache/public-data';
import {publicAuctionSelect,publicWhere,toPublicAuction} from './catalog';

/** Customer draws exclude illustrative results and test auctions. Past winners require a settlement. */
export function listDraws(tab:'past'|'upcoming',page=1){
  return cachedPublicData(`customer-draws:${tab}:${page}`,5000,()=>db.$transaction(async tx=>{
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const state:Prisma.AuctionWhereInput=tab==='upcoming'
      ?{status:{in:['LIVE','SCHEDULED']},endsAt:{gt:now},settlement:{is:null},result:{is:null}}
      :{OR:[{settlement:{isNot:null}},{result:{is:null},OR:[{status:'CANCELLED'},{endsAt:{lte:now}}]}]};
    const where:Prisma.AuctionWhereInput={AND:[publicWhere(now),{isDemo:false},state]};
    const [rows,total]=await Promise.all([
      tx.auction.findMany({where,select:publicAuctionSelect,orderBy:[{endsAt:tab==='past'?'desc':'asc'},{id:'asc'}],take:12,skip:(page-1)*12}),
      tx.auction.count({where}),
    ]);
    return {items:rows.map(row=>toPublicAuction(row,now)),total,page,totalPages:Math.ceil(total/12),serverNow:now.toISOString()};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:30000}));
}
