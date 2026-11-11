import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{await requireUser(request);return Response.json({error:'Choose your payment method on Chapa hosted checkout.',code:'HOSTED_CHECKOUT_REQUIRED'},{status:410,headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
