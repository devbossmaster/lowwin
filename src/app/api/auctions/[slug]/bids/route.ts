import { z } from 'zod';
import {smallJson,PrivateApiError,requireMutationOrigin,limitUserMutation} from '@/modules/auth/private-api';
import { db } from '@/lib/db';
import {getMiniSession} from '@/modules/auth/mini-access';
import { BidError, getOwnBidState, submitBid } from '@/modules/auctions/bids';

export const runtime='nodejs';
const privateHeaders={'Cache-Control':'private, no-store, max-age=0'};
const bodySchema=z.object({amount:z.string(),key:z.string().uuid(),feeVersion:z.number().int().min(1)}).strict();
async function userId(request:Request) {
  const session=await getMiniSession(request.headers);
  return session?.user.id??null;
}
function errorResponse(error:unknown) {
  if(error instanceof PrivateApiError)return Response.json({error:error.message,code:'INVALID_INPUT'},{status:error.status,headers:privateHeaders});
  if(error instanceof BidError)return Response.json({error:error.message,code:error.code},{status:error.status,headers:privateHeaders});
  if(error instanceof z.ZodError)return Response.json({error:'Enter a valid ETB amount, fee version and request key.',code:'INVALID_INPUT'},{status:422,headers:privateHeaders});
  if(error instanceof SyntaxError)return Response.json({error:'Send a valid JSON bid request.',code:'INVALID_INPUT'},{status:400,headers:privateHeaders});
  return Response.json({error:'Bid could not be processed. Retry with the same request key.',code:'UNAVAILABLE'},{status:503,headers:privateHeaders});
}
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}) {
  try {
    const id=await userId(request);
    if(!id)return Response.json({error:'Sign in through Telegram.',code:'UNAUTHENTICATED'},{status:401,headers:privateHeaders});
    const {slug}=await params;
    return Response.json(await getOwnBidState(db,id,slug),{headers:privateHeaders});
  } catch(error){return errorResponse(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}) {
  try {
    const id=await userId(request);
    if(!id)return Response.json({error:'Sign in through Telegram.',code:'UNAUTHENTICATED'},{status:401,headers:privateHeaders});
    requireMutationOrigin(request);
    await limitUserMutation(request,id);
    if(Number(request.headers.get('content-length')??0)>4096)return Response.json({error:'Request is too large.',code:'INVALID_INPUT'},{status:413,headers:privateHeaders});
    const body=bodySchema.parse(await smallJson(request));
    const {slug}=await params;
    return Response.json(await submitBid(db,{userId:id,auctionSlug:slug,amount:body.amount,key:body.key,feeVersion:body.feeVersion}),{status:201,headers:privateHeaders});
  } catch(error){return errorResponse(error)}
}
