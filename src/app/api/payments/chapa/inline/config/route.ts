import {db} from '@/lib/db';
import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {chapaInlineConfig} from '@/modules/payments/chapa-inline';
import {chapaHttpError} from '@/modules/payments/chapa-http';
import {measureChapa,timedChapaResponse} from '@/modules/payments/chapa-timing';
export const runtime='nodejs';
export async function GET(request:Request){return timedChapaResponse(async()=>{try{const userId=await measureChapa('auth',()=>requireUser(request));return Response.json(await chapaInlineConfig(db,userId),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}})}
