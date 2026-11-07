import {z} from 'zod';
import {db} from '@/lib/db';
import {requireUser,privateHeaders} from '@/modules/auth/private-api';
import {directMethodsForUser} from '@/modules/payments/chapa-direct';
import {chapaHttpError} from '@/modules/payments/chapa-http';
export const runtime='nodejs';
export async function GET(request:Request){try{const userId=await requireUser(request),query=new URL(request.url).searchParams,raw=query.get('amountCents');if([...query.keys()].some(key=>key!=='amountCents')||query.getAll('amountCents').length>1)throw new Error('Invalid filters');const amount=raw===null?undefined:BigInt(z.string().regex(/^\d{1,10}$/).parse(raw));return Response.json(await directMethodsForUser(db,userId,amount),{headers:privateHeaders})}catch(error){return chapaHttpError(error)}}
