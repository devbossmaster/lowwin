import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
export const runtime='nodejs';
export async function GET(request:Request){try{await requireUser(request);return Response.json({error:'Customer wallets have been retired. Use direct bid payment.',code:'WALLETS_RETIRED'},{status:410,headers:privateHeaders})}catch(error){return privateError(error)}}
