import {randomUUID} from 'node:crypto';
import {databaseErrorSummary} from '@/lib/database-error';
import {privateError,privateHeaders,PrivateApiError} from '@/modules/auth/private-api';
import {PaymentError} from './reference';

// Only fixed operation names and whitelisted error codes reach logs. Never log
// receipt text, payment references, user/session data or exception messages.
export function paymentHttpError(error:unknown,operation:'list'|'submit'|'scan',started:number){
  if(error instanceof PaymentError)return Response.json({error:error.message},{status:error.status,headers:privateHeaders});
  const response=privateError(error);
  if(response.status!==503||error instanceof PrivateApiError)return response;
  const traceId=randomUUID();
  const {code,kind,sqlState}=databaseErrorSummary(error);
  console.error(JSON.stringify({event:'payment_request_error',traceId,operation,code,kind,...(sqlState?{sqlState}:{}),elapsedMs:Math.round(performance.now()-started)}));
  return Response.json({error:'This information is temporarily unavailable.',traceId},{status:503,headers:privateHeaders});
}
