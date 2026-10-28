import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createChapaCheckout,listChapaCheckouts} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await listChapaCheckouts(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request){
 return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),body=await smallJson(request);return Response.json(await measureChapa('checkout',()=>createChapaCheckout(db,auth.userId,body,auth.reauthorize)),{status:202,headers:privateHeaders})}catch(error){return chapaHttpError(error)}});
}
