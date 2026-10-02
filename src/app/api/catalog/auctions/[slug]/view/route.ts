import { db } from '@/lib/db';
import {recordAuctionView} from '@/modules/auctions/activity';

export const runtime='nodejs';
const headers={'Cache-Control':'no-store, max-age=0'};

export async function POST(_request:Request,context:{params:Promise<{slug:string}>}) {
  const {slug}=await context.params;
  if(!/^[a-z0-9-]{1,120}$/.test(slug))return Response.json({error:'Invalid auction.'},{status:422,headers});
  try{
    const updated=await recordAuctionView(db,slug);
    if(!updated)return Response.json({error:'Auction not found.'},{status:404,headers});
    return Response.json(updated,{headers});
  }catch{return Response.json({error:'View could not be recorded.'},{status:503,headers})}
}
