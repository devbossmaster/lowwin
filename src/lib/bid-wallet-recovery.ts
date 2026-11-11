import type {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote} from './bid-batch-client';
import {ChapaClientError} from './chapa-client';
const key=(identity:string,slug:string)=>['lowin-private',identity,'bid-wallet-recovery',slug] as const;
/** Preserve only the original wallet command after dismissal, never a success
 * claim. The existing wallet endpoint reconciles this same immutable quote. */
export function readBidWalletRecovery(client:QueryClient,identity:string,slug:string){return client.getQueryData<BidBatchQuote>(key(identity,slug))??null}
export function retainBidWalletRecovery(client:QueryClient,identity:string,quote:BidBatchQuote){
 const queryKey=key(identity,quote.auctionSlug);client.getQueryCache().build(client,{queryKey,gcTime:Infinity});client.setQueryData(queryKey,structuredClone(quote));
}
export function clearBidWalletRecovery(client:QueryClient,identity:string,quote:BidBatchQuote){
 if(readBidWalletRecovery(client,identity,quote.auctionSlug)?.id===quote.id)client.removeQueries({queryKey:key(identity,quote.auctionSlug),exact:true});
}
/** Authentication/rate limits cannot establish whether an earlier request
 * committed. Only explicit business rejections allow a new wallet draft. */
export function bidWalletSubmissionRejected(cause:unknown){return cause instanceof ChapaClientError&&cause.status>=400&&cause.status<500&&['TERMS_CHANGED','LEGACY_TERMS','CAP_REACHED','CONSECUTIVE_LIMIT','OWN_DUPLICATE','AUCTION_CLOSED','COUPON_UNAVAILABLE','INSUFFICIENT_POINTS','PAYMENT_STARTED','INVALID_AMOUNT','BIDDING_RESTRICTED','CONTACT_REQUIRED'].includes(cause.code)}
