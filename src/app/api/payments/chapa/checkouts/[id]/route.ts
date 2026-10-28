import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {getChapaCheckout,verifyChapaCheckout} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await getChapaCheckout(db,await requireUser(request),(await params).id),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),id=(await params).id;return Response.json(await measureChapa('checkout',()=>verifyChapaCheckout(db,id,auth.userId,auth.reauthorize)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
