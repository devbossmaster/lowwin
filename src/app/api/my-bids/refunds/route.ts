import {z} from 'zod';
import {db} from '@/lib/db';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {ownAuctionRefunds} from '@/modules/profile/auction-refunds';
export const runtime='nodejs';
export async function GET(request:Request){
 try{
  const userId=await requireUser(request),{auction}=z.object({auction:z.string().regex(/^\d{1,10}$/)}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json({refund:(await ownAuctionRefunds(db,userId,[auction])).get(auction)??null},{headers:privateHeaders});
 }catch(error){return privateError(error)}
}
