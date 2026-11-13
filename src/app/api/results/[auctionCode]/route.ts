import { db } from '@/lib/db';
import { getPublicResult } from '@/modules/auctions/results';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{auctionCode:string}>}) {
  try{await requireUser(request);const row=await getPublicResult(db,(await params).auctionCode);return Response.json(row??{error:'Result not found.'},{status:row?200:404,headers:privateHeaders})}
  catch(error){return privateError(error)}
}
