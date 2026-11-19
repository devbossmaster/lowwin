import type {BidBatchQuote} from './bid-batch-client';

/** One immutable draft owns its read-only quote and its distinct payment keys. */
export type BidQuoteAttempt={fingerprint:string;key:string;paymentKey:string;walletKey?:string;walletQuote?:boolean;quote?:BidBatchQuote;pending?:Promise<BidBatchQuote>;controller?:AbortController};

export function bidQuoteAttemptFor(current:BidQuoteAttempt|null,fingerprint:string):BidQuoteAttempt{
 if(current?.fingerprint===fingerprint)return current;
 current?.controller?.abort();
 return {fingerprint,key:crypto.randomUUID(),paymentKey:crypto.randomUUID()};
}

export function loadBidQuote(attempt:BidQuoteAttempt,load:()=>Promise<BidBatchQuote>):Promise<BidBatchQuote>{
 if(attempt.quote)return Promise.resolve(attempt.quote);
 if(attempt.pending)return attempt.pending;
 const pending=load().then(quote=>{attempt.quote=quote;return quote});
 attempt.pending=pending;
 const release=()=>{if(attempt.pending===pending)attempt.pending=undefined};
 void pending.then(release,release);
 return pending;
}

/** Atomic wallet commands include approvedTotal in their request hash; a quote
 * with the same draft must never consume that command's idempotency key. */
export function walletBidAttemptKey(attempt:BidQuoteAttempt){return attempt.walletKey??=crypto.randomUUID()}
