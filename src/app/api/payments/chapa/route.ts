import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {publicChapaAvailability} from '@/modules/payments/chapa';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{await requireUser(request);return Response.json(publicChapaAvailability(),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
