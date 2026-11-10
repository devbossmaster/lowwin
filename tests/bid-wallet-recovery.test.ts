import {describe,expect,it} from 'vitest';
import {SessionPrivateQueryCache} from '../src/components/private-query-cache';
import {clearBidWalletRecovery,readBidWalletRecovery,retainBidWalletRecovery} from '../src/lib/bid-wallet-recovery';
import type {BidBatchQuote} from '../src/lib/bid-batch-client';
const quote={id:'original-wallet-quote',quoteHash:'original-hash',auctionSlug:'owned-auction',lines:[{number:'2.00'}],total:'10.00'} as BidBatchQuote;
describe('original wallet quote after an interrupted bid payment',()=>{
 it('keeps the same immutable command through dismissal and ordinary query invalidation without claiming success',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');const draft=structuredClone(quote);retainBidWalletRecovery(cache.queryClient,'owner:session',draft);draft.lines[0].number='99.00';
  cache.invalidate('owner:session',['/api/wallet','/api/my-bids']);expect(readBidWalletRecovery(cache.queryClient,'owner:session',quote.auctionSlug)).toEqual(quote);expect(cache.queryClient.isFetching()).toBe(0);expect(readBidWalletRecovery(cache.queryClient,'other:session',quote.auctionSlug)).toBeNull();
 });
 it('clears only the reconciled original quote and drops all private recovery on account change',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');retainBidWalletRecovery(cache.queryClient,'owner:session',quote);clearBidWalletRecovery(cache.queryClient,'owner:session',{...quote,id:'other-quote'});expect(readBidWalletRecovery(cache.queryClient,'owner:session',quote.auctionSlug)).not.toBeNull();clearBidWalletRecovery(cache.queryClient,'owner:session',quote);expect(readBidWalletRecovery(cache.queryClient,'owner:session',quote.auctionSlug)).toBeNull();retainBidWalletRecovery(cache.queryClient,'owner:session',quote);cache.setIdentity('other:session');expect(readBidWalletRecovery(cache.queryClient,'owner:session',quote.auctionSlug)).toBeNull();
 });
});
