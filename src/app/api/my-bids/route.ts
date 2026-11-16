import { db } from '@/lib/db';
import { requireUser,privateHeaders,privateError } from '@/modules/auth/private-api';
import { getPersonalBidList,getPersonalBidAuctionList } from '@/modules/profile/bid-list';
export const runtime='nodejs';
export async function GET(request:Request) {
  try {
    const input=Object.fromEntries(new URL(request.url).searchParams),userId=await requireUser(request);
    return Response.json(await (input.grouped==='1'?getPersonalBidAuctionList(db,userId,input):getPersonalBidList(db,userId,input)),{headers:privateHeaders});
  } catch(error) {return privateError(error)}
}
