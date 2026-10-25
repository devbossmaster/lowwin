import {db} from '@/lib/db';
import {privateHeaders,requireMutationOrigin,requireUser} from '@/modules/auth/private-api';
import {requirePaymentSession} from '@/modules/payments/session';
import {getArifPayCheckout,verifyArifPayCheckout} from '@/modules/payments/arifpay';
import {arifPayHttpError} from '@/modules/payments/arifpay-http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{const userId=await requireUser(request);return Response.json(await getArifPayCheckout(db,userId,(await params).id),{headers:privateHeaders})}catch(error){return arifPayHttpError(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{requireMutationOrigin(request);const auth=await requirePaymentSession(request);return Response.json(await verifyArifPayCheckout(db,(await params).id,auth.userId,auth.reauthorize),{headers:privateHeaders})}catch(error){return arifPayHttpError(error)}
}
