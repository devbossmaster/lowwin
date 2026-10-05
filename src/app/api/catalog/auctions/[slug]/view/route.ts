import { db } from '@/lib/db';
import {recordAuctionView} from '@/modules/auctions/activity';
import {requireUser,requireMutationOrigin,privateError,privateHeaders} from '@/modules/auth/private-api';

export const runtime='nodejs';
const headers=privateHeaders;

export async function POST(request:Request,context:{params:Promise<{slug:string}>}) {
  const {slug}=await context.params;
  if(!/^[a-z0-9-]{1,120}$/.test(slug))return Response.json({error:'Invalid auction.'},{status:422,headers});
  try{
    requireMutationOrigin(request);
    const viewerId=await requireUser(request);
    const updated=await recordAuctionView(db,slug,viewerId);
    if(!updated)return Response.json({error:'Auction not found.'},{status:404,headers});
    return Response.json(updated,{headers});
  }catch(error){return privateError(error)}
}
