import {z} from 'zod';
import {db} from '@/lib/db';
import {PrivateApiError,privateError,privateHeaders,requireUser} from '@/modules/auth/private-api';
import {getBidDiscountQuote,ReferralError} from '@/modules/referrals/service';

export const runtime='nodejs';
const querySchema=z.object({couponId:z.uuid().optional(),feeVersion:z.coerce.number().int().positive().optional()}).strict();
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){
 try{
  const userId=await requireUser(request),{slug}=await params;
  if(!/^[a-z0-9-]{1,120}$/.test(slug))throw new PrivateApiError(404,'Auction not found.');
  const search=new URL(request.url).searchParams;
  if([...search.keys()].some(key=>search.getAll(key).length>1))throw new PrivateApiError(422,'Choose one discount and fee version.');
  const query=querySchema.parse(Object.fromEntries(search));
  const quote=await getBidDiscountQuote(db,userId,slug,query.couponId);
  if(query.feeVersion!==undefined&&quote.feeVersion!==query.feeVersion)throw new PrivateApiError(409,'The fee changed. Refresh the auction and try again.');
  return Response.json(quote,{headers:privateHeaders});
 }catch(error){
  if(error instanceof ReferralError)return Response.json({error:error.message,code:error.code},{status:error.status,headers:privateHeaders});
  return privateError(error);
 }
}
