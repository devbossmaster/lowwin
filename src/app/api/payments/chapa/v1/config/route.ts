import {db} from '@/lib/db';
import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {chapaV1Config} from '@/modules/payments/chapa-v1';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await chapaV1Config(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
