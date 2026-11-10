import {db} from '@/lib/db';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {getWalletHistory} from '@/modules/wallet/history';
export const runtime='nodejs';
export async function GET(request:Request){
 try{return Response.json(await getWalletHistory(db,await requireUser(request),Object.fromEntries(new URL(request.url).searchParams)),{headers:privateHeaders})}
 catch(error){return privateError(error)}
}
