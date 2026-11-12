import {db} from '@/lib/db';
import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {chapaInlineConfig} from '@/modules/payments/chapa-inline';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await chapaInlineConfig(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
