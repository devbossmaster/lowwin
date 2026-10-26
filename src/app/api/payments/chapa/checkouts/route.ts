import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createChapaCheckout,listChapaCheckouts} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await listChapaCheckouts(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request){try{requireMutationOrigin(request);const auth=await requirePaymentSession(request);return Response.json(await createChapaCheckout(db,auth.userId,await smallJson(request),auth.reauthorize),{status:202,headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
