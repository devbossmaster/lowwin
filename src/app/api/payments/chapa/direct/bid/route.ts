import {db} from '@/lib/db';
import {requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createBidDirectCheckout} from '@/modules/payments/chapa-direct';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function POST(request:Request){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),body=await smallJson(request),result=await createBidDirectCheckout(db,auth.userId,body,auth.reauthorize);return Response.json(result,{status:result.kind==='payment'?202:200,headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
