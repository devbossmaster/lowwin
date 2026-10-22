import {db} from '@/lib/db';
import {privateHeaders,requireMutationOrigin,requireUser,smallJson} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {createArifPayCheckout,listArifPayCheckouts} from '@/modules/payments/arifpay';
import {arifPayHttpError} from '@/modules/payments/arifpay-http';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await listArifPayCheckouts(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return arifPayHttpError(error)}}
export async function POST(request:Request){
 try{requireMutationOrigin(request);const auth=await requirePaymentSession(request);return Response.json(await createArifPayCheckout(db,auth.userId,await smallJson(request),auth.reauthorize),{status:202,headers:privateHeaders})}catch(error){return arifPayHttpError(error)}
}
