import {z} from 'zod';
import {privateHeaders,PrivateApiError} from '../auth/private-api';
import {ReferralError} from '../referrals/service';
import {BidError} from '../auctions/bids';
import {RequestBodyError} from '@/lib/request-body';
import {ChapaError} from './chapa-provider';
export function chapaHttpError(error:unknown){
 const known=error instanceof ChapaError||error instanceof PrivateApiError||error instanceof ReferralError||error instanceof BidError||error instanceof RequestBodyError,status=known?error.status:error instanceof z.ZodError||error instanceof SyntaxError?422:503;
 return Response.json({error:known?error.message:status===422?'Check the supplied payment fields.':'Payment confirmation is unavailable. Keep the payment ID and retry the same request.',code:error instanceof ChapaError||error instanceof BidError||error instanceof ReferralError?error.code:status===422?'INVALID_INPUT':'PAYMENT_UNAVAILABLE'},{status,headers:privateHeaders});
}
