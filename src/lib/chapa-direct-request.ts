import {ChapaClientError} from './chapa-client';

/** Only known creation rejections release the original direct-payment intent.
 * Coupon validation runs before checkout persistence or a provider request;
 * an unavailable response must still retain the original operation. */
export function chapaDirectCreationRejected(cause:unknown):boolean{
 if(!(cause instanceof ChapaClientError))return false;
 return ['TERMS_CHANGED','INVALID_PHONE','METHOD_UNAVAILABLE','PAYMENT_STARTED','CONTACT_REQUIRED','AUCTIONS_PAUSED'].includes(cause.code)
  ||cause.status===409&&['COUPON_UNAVAILABLE','DEPOSIT_BONUS_CHANGED'].includes(cause.code);
}
