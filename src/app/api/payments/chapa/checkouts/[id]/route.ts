import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders} from '@/modules/auth/private-api';
import {requirePaymentSessionWithRead} from '@/modules/payments/session';
import {getChapaCheckout,prepareOwnedChapaVerification} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await getChapaCheckout(db,await requireUser(request),(await params).id),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return timedChapaResponse(async()=>{try{
 requireMutationOrigin(request);
 const walletReturn=request.headers.get('X-Lowwin-Wallet-Return')==='1';
 const {reauthorize,prepared}=await measureChapa('auth',()=>requirePaymentSessionWithRead(request,async userId=>prepareOwnedChapaVerification(db,(await params).id,userId,undefined,walletReturn)));
 return Response.json(await measureChapa('checkout',()=>prepared(reauthorize)),{headers:privateHeaders});
}catch(error){return chapaHttpError(error)}})}
