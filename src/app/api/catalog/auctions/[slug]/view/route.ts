import { db } from '@/lib/db';
import { publicWhere } from '@/modules/auctions/catalog';

export const runtime='nodejs';
const headers={'Cache-Control':'no-store, max-age=0'};

export async function POST(_request:Request,context:{params:Promise<{slug:string}>}) {
  const {slug}=await context.params;
  if(!/^[a-z0-9-]{1,120}$/.test(slug))return Response.json({error:'Invalid auction.'},{status:422,headers});
  try{
    const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const auction=await db.auction.findFirst({where:{AND:[publicWhere(now),{slug}]},select:{id:true}});
    if(!auction)return Response.json({error:'Auction not found.'},{status:404,headers});
    const updated=await db.auction.update({where:{id:auction.id},data:{publicViewCount:{increment:1}},select:{publicViewCount:true}});
    return Response.json({views:updated.publicViewCount.toString()},{headers});
  }catch{return Response.json({error:'View could not be recorded.'},{status:503,headers})}
}
