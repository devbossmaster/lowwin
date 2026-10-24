import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {db} from '@/lib/db';
import {readWalletBalance} from '@/modules/wallet/balance';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await readWalletBalance(db,await requireUser(request)),{headers:privateHeaders})}catch(error){return privateError(error)}}
