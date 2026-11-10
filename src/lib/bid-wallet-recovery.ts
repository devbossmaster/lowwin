import type {QueryClient} from '@tanstack/react-query';
import type {BidBatchQuote} from './bid-batch-client';
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
