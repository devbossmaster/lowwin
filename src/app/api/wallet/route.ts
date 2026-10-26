import {requireUser,privateHeaders,privateError} from '@/modules/auth/private-api';
import {db} from '@/lib/db';
import {readWalletBalance} from '@/modules/wallet/balance';
import {databaseErrorSummary} from '@/lib/database-error';
export const runtime='nodejs';
export async function GET(request:Request){
 const started=performance.now();let authenticatedAt:number|null=null;
 const timed=(response:Response)=>{
  const finished=performance.now(),authMs=(authenticatedAt??finished)-started;
  response.headers.set('Server-Timing',`auth;dur=${authMs.toFixed(1)}${authenticatedAt===null?'':`, ledger;dur=${(finished-authenticatedAt).toFixed(1)}`}, total;dur=${(finished-started).toFixed(1)}`);
  return response;
 };
 try{const userId=await requireUser(request);authenticatedAt=performance.now();return timed(Response.json(await readWalletBalance(db,userId),{headers:privateHeaders}))}
 catch(error){
  const response=privateError(error);
  if(response.status>=500){const {code,kind,sqlState,reason}=databaseErrorSummary(error);console.warn('Wallet read unavailable',{stage:authenticatedAt===null?'auth':'ledger',code,kind,...(sqlState?{sqlState}:{}),...(reason?{reason}:{}),elapsedMs:Math.round(performance.now()-started)})}
  return timed(response);
 }
}
