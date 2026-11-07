import {z} from 'zod';
import {privateHeaders,PrivateApiError} from '../auth/private-api';
import {ReferralError} from '../referrals/service';
import {BidError} from '../auctions/bids';
import {RequestBodyError} from '@/lib/request-body';
import {ChapaError,ChapaProviderError} from './chapa-provider';
import {chapaRequestReasonMessage} from '@/lib/chapa-payment-reason';
export function chapaHttpError(error:unknown){
 if(error instanceof ChapaProviderError&&error.paymentReason)return Response.json({error:chapaRequestReasonMessage(error.paymentReason),code:error.paymentReason},{status:422,headers:privateHeaders});
 const known=error instanceof ChapaError||error instanceof PrivateApiError||error instanceof ReferralError||error instanceof BidError||error instanceof RequestBodyError,status=known?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;
 return Response.json({error:known?error.message:status===422?'Check the supplied payment fields.':'Payment confirmation is unavailable. Keep the payment ID and retry the same request.',code:error instanceof ChapaError||error instanceof BidError||error instanceof ReferralError?error.code:status===422?'INVALID_INPUT':'PAYMENT_UNAVAILABLE'},{status,headers:privateHeaders});
}
