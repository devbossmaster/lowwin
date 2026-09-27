import { db } from '@/lib/db';
import { getPublicResult } from '@/modules/auctions/results';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store, max-age=0'};
export async function GET(_request:Request,{params}:{params:Promise<{auctionCode:string}>}) {
  try{const row=await getPublicResult(db,(await params).auctionCode);return Response.json(row??{error:'Result not found.'},{status:row?200:404,headers})}
  catch{return Response.json({error:'Result is temporarily unavailable.'},{status:503,headers})}
}
