import { z } from 'zod';
import {PrivateApiError,requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import { db } from '@/lib/db';
import {getMiniSession} from '@/modules/auth/mini-access';
import { BidError, getOwnBidState,submitBidInTransaction } from '@/modules/auctions/bids';
import {requirePaymentSession} from '@/modules/payments/session';
import {walletBidsEnabled} from '@/modules/payments/chapa';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {PAYMENT_TRANSACTION_OPTIONS} from '@/modules/payments/timing';

export const runtime='nodejs';
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
    const {wallet:_,previousMax:__,...state}=await getOwnBidState(db,id,slug,process.env,false);
    return Response.json({...state,paymentMode:state.terms.ruleVersion==='lowest-unique-v4'?(process.env.PAYMENT_GATEWAY==='CHAPA'?'CHAPA':'UNCONFIGURED'):'LEGACY_READ_ONLY',walletBidsEnabled:walletBidsEnabled()},{headers:privateHeaders});
  } catch(error){return errorResponse(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}) {
  try {
    requireMutationOrigin(request);
    const auth=await requirePaymentSession(request);
    if(!walletBidsEnabled())return Response.json({error:'Wallet bidding is not available yet.',code:'WALLET_BIDS_DISABLED'},{status:410,headers:privateHeaders});
    const body=z.object({key:z.string().uuid(),amount:z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/),feeVersion:z.number().int().min(1),couponId:z.string().uuid().optional()}).strict().parse(await smallJson(request)),{slug}=await params;
    const receipt=await db.$transaction(async tx=>{await auth.reauthorize(tx);const auction=await tx.auction.findUnique({where:{slug},select:{terms:{select:{ruleVersion:true}}}});if(!isSubmissionFeeOnly(auction?.terms?.ruleVersion))throw new BidError('AUCTION_CLOSED',409,'This auction keeps its original payment terms.');return submitBidInTransaction(tx,{...body,userId:auth.userId,auctionSlug:slug})},PAYMENT_TRANSACTION_OPTIONS);
    return Response.json(receipt,{headers:privateHeaders});
  } catch(error){return errorResponse(error)}
}
