import {db} from '@/lib/db';
import {requireUser,requireMutationOrigin,privateHeaders,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createInlineCheckout,findInlineCheckoutByKey} from '@/modules/payments/chapa-inline';
import {ChapaError} from '@/modules/payments/chapa-provider';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function GET(request:Request){try{const userId=await requireUser(request),query=new URL(request.url).searchParams;if(query.getAll('key').length!==1||[...query.keys()].some(key=>key!=='key'))throw new ChapaError(422,'INVALID_INPUT','Use the original payment request key.');return Response.json(await findInlineCheckoutByKey(db,userId,query.get('key')!),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
export async function POST(request:Request){return timedChapaResponse(async()=>{try{requireMutationOrigin(request);const auth=await measureChapa('auth',()=>requirePaymentSession(request));return Response.json(await createInlineCheckout(db,auth.userId,await smallJson(request),auth.reauthorize),{status:202,headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
