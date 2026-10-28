import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createChapaCheckout,listChapaCheckouts} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
import {ChapaError} from '@/modules/payments/chapa-provider';
import {z} from 'zod';
export const runtime='nodejs';
export async function GET(request:Request){
 try{
  const userId=await requireUser(request),query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>key!=='purpose')||query.getAll('purpose').length>1)throw new ChapaError(422,'INVALID_INPUT','Check the supplied payment filters.');
  const purpose=z.enum(['TOP_UP','BID']).optional().parse(query.get('purpose')??undefined);
  return Response.json(await listChapaCheckouts(db,userId,purpose),{headers:privateHeaders});
 }catch(error){return chapaHttpError(error)}
}
export async function POST(request:Request){
 return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request)),body=await smallJson(request);return Response.json(await measureChapa('checkout',()=>createChapaCheckout(db,auth.userId,body,auth.reauthorize)),{status:202,headers:privateHeaders})}catch(error){return chapaHttpError(error)}});
}
