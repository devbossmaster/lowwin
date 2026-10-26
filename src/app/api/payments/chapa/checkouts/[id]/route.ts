import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {getChapaCheckout,verifyChapaCheckout} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await getChapaCheckout(db,await requireUser(request),(await params).id),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{requireMutationOrigin(request);const auth=await requirePaymentSession(request);return Response.json(await verifyChapaCheckout(db,(await params).id,auth.userId,auth.reauthorize),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
