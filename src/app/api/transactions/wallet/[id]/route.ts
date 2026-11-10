import {db} from '@/lib/db';
import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {getWalletTransaction} from '@/modules/wallet/transactions';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{return Response.json(await getWalletTransaction(db,await requireUser(request),(await params).id),{headers:privateHeaders})}
 catch(error){return privateError(error)}
}
