import {db} from '@/lib/db';
import {requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {quoteBidBatch} from '@/modules/auctions/batch';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function POST(request:Request){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),body=await smallJson(request);return Response.json(await measureChapa('database',()=>quoteBidBatch(db,auth.userId,body,auth.reauthorize)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
