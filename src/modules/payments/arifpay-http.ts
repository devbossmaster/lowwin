import {z} from 'zod';
import {PrivateApiError,privateHeaders} from '../auth/private-api';
import {ArifPayError} from './arifpay-provider';
export function arifPayHttpError(error:unknown){
 const known=error instanceof ArifPayError||error instanceof PrivateApiError;
 const status=known?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;
 return Response.json({error:known?error.message:status===422?'Check the payment details.':'Payment status is temporarily unavailable. Keep the same payment ID and retry.',code:error instanceof ArifPayError?error.code:status===422?'INVALID_INPUT':'UNAVAILABLE'},{status,headers:privateHeaders});
}
