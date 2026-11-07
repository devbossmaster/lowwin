import {db} from '@/lib/db';
import {requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {payBidBatchWallet} from '@/modules/auctions/batch';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),{id}=await context.params,body=await smallJson(request);return Response.json(await measureChapa('database',()=>payBidBatchWallet(db,auth.userId,id,body,auth.reauthorize)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
