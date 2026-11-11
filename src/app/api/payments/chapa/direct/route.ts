import {requireMutationOrigin,privateHeaders} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function POST(request:Request){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);await measureChapa('auth',()=>requirePaymentSession(request));return Response.json({error:'Use Chapa hosted checkout to start a payment.',code:'HOSTED_CHECKOUT_REQUIRED'},{status:410,headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
