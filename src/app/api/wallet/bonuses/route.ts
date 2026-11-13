import {z} from 'zod';
import {db} from '@/lib/db';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {listOwnDepositBonuses} from '@/modules/wallet/deposit-bonus';
export const runtime='nodejs';
export async function GET(request:Request){try{const userId=await requireUser(request),query=Object.fromEntries(new URL(request.url).searchParams);return Response.json(await listOwnDepositBonuses(db,userId,query),{headers:privateHeaders})}catch(error){if(error instanceof z.ZodError)return Response.json({error:'Choose a valid bonus history page.'},{status:422,headers:privateHeaders});return privateError(error)}}
