import {db} from '@/lib/db';
import {getMiniSession} from '@/modules/auth/mini-access';
import {privateHeaders} from '@/modules/auth/private-api';
import {breakdownQuery,getResultBreakdown} from '@/modules/auctions/result-breakdown';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{auctionCode:string}>}){
 const parsed=breakdownQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:'Invalid result page.'},{status:422,headers:privateHeaders});
 try{
  if(!await getMiniSession(request.headers))return Response.json({error:'Sign in through Telegram.'},{status:401,headers:privateHeaders});
  const result=await getResultBreakdown(db,(await params).auctionCode,parsed.data);
  return Response.json(result??{error:'A finalized result is not available.'},{status:result?200:404,headers:privateHeaders});
 }catch{return Response.json({error:'Result details are temporarily unavailable.'},{status:503,headers:privateHeaders})}
}
