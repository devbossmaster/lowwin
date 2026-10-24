import {privateHeaders,requireUser} from '@/modules/auth/private-api';
import {arifPayAvailability,arifPayCanaryAllowed} from '@/modules/payments/arifpay-provider';
import {arifPayHttpError} from '@/modules/payments/arifpay-http';
export const runtime='nodejs';
export async function GET(request:Request){try{const userId=await requireUser(request),health=arifPayAvailability();return Response.json(arifPayCanaryAllowed(userId)?health:{...health,enabled:false,reason:'Direct payment is not available for this account yet.'},{headers:privateHeaders})}catch(error){return arifPayHttpError(error)}}
