import {db} from '@/lib/db';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {breakdownQuery,getResultBreakdown} from '@/modules/auctions/result-breakdown';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{auctionCode:string}>}){
 try{
  await requireUser(request);
  const parsed=breakdownQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)return Response.json({error:'Invalid result page.'},{status:422,headers:privateHeaders});
  const result=await getResultBreakdown(db,(await params).auctionCode,parsed.data);
  return Response.json(result??{error:'A finalized result is not available.'},{status:result?200:404,headers:privateHeaders});
 }catch(error){return privateError(error)}
}
