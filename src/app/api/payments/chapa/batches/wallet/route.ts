import {db} from '@/lib/db';
import {requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createAndPayBidBatchWallet,getOwnWalletBidBatch} from '@/modules/auctions/batch';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function POST(request:Request){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),body=await smallJson(request);return Response.json(await measureChapa('database',()=>createAndPayBidBatchWallet(db,auth.userId,body,auth.reauthorize)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
export async function GET(request:Request){return timedChapaResponse(async()=>{try{const auth=await measureChapa('auth',()=>requirePaymentSession(request)),key=new URL(request.url).searchParams.get('key')??'',result=await measureChapa('database',()=>getOwnWalletBidBatch(db,auth.userId,{key},auth.reauthorize));return Response.json(result,{status:result.kind==='pending'?202:200,headers:{...privateHeaders,...(result.kind==='pending'?{'Retry-After':'1'}:{})}})}catch(error){return chapaHttpError(error)}})}
