import {describe,expect,it,vi} from 'vitest';
import {loadBidQuote,walletBidAttemptKey,type BidQuoteAttempt} from '../src/lib/bid-quote-readiness';
import type {BidBatchQuote} from '../src/lib/bid-batch-client';

const attempt=():BidQuoteAttempt=>({fingerprint:'validated-selection',key:'quote-key',paymentKey:'provider-key'});
const quote=(id='owned-quote')=>({id,total:'10.00'} as BidBatchQuote);
describe('draft-owned bid quote readiness',()=>{
 it('joins background readiness and explicit Pay into one request and reuses the completed quote',async()=>{
  const owned=attempt();let resolve!:(value:BidBatchQuote)=>void;
  const load=vi.fn(()=>new Promise<BidBatchQuote>(done=>{resolve=done}));
  const background=loadBidQuote(owned,load),pay=loadBidQuote(owned,load);
  expect(pay).toBe(background);expect(load).toHaveBeenCalledTimes(1);expect(owned.quote).toBeUndefined();
  resolve(quote());expect(await pay).toEqual(quote());expect(await loadBidQuote(owned,load)).toEqual(quote());expect(load).toHaveBeenCalledTimes(1);
 });
 it('allows explicit same-key recovery after a failed readiness request',async()=>{
  const owned=attempt(),load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(quote());
  await expect(loadBidQuote(owned,load)).rejects.toThrow('offline');expect(owned.pending).toBeUndefined();expect(owned.key).toBe('quote-key');
  expect(await loadBidQuote(owned,load)).toEqual(quote());expect(load).toHaveBeenCalledTimes(2);expect(owned.key).toBe('quote-key');
 });
 it('cannot replace a changed draft with the previous draft response',async()=>{
  const previous=attempt(),current={...attempt(),fingerprint:'changed-selection',key:'changed-key'};let resolve!:(value:BidBatchQuote)=>void;
  const oldRead=loadBidQuote(previous,()=>new Promise(done=>{resolve=done}));await loadBidQuote(current,async()=>quote('new'));
  resolve(quote('old'));await oldRead;expect(current.quote?.id).toBe('new');expect(current.key).toBe('changed-key');
 });
 it('keeps an atomic wallet key separate and stable while a quote is still preparing',async()=>{
  const owned=attempt();let resolve!:(value:BidBatchQuote)=>void;const pending=loadBidQuote(owned,()=>new Promise(done=>{resolve=done}));
  const walletKey=walletBidAttemptKey(owned);expect(walletKey).not.toBe(owned.key);expect(walletKey).not.toBe(owned.paymentKey);expect(walletBidAttemptKey(owned)).toBe(walletKey);
  resolve(quote());await pending;expect(walletBidAttemptKey(owned)).toBe(walletKey);expect(owned.key).toBe('quote-key');expect(owned.paymentKey).toBe('provider-key');
 });
});
