import {privateHeaders,requireUser,privateError} from '@/modules/auth/private-api';
export async function GET(request:Request){try{await requireUser(request);return Response.json({error:'Customer funding has been retired. Pay directly through ArifPay.',code:'WALLETS_RETIRED'},{status:410,headers:privateHeaders})}catch(error){return privateError(error)}}
