import {QueryClient} from '@tanstack/react-query';
import {describe,expect,it} from 'vitest';
import {clearBidFundingDraft,readBidFundingDraft,retainBidFundingDraft} from '../src/lib/bid-funding-draft';
describe('bid draft during wallet funding',()=>{
 it('retains editable numbers and payment details only in the owning account and bounds retained drafts',()=>{
  const client=new QueryClient(),draft={numbers:['4.25','6.00'],method:'wallet',phone:'911652904',applyCoupon:true};
  retainBidFundingDraft(client,'alice','auction',draft);draft.numbers.push('8.00');
  expect(readBidFundingDraft(client,'alice','auction')?.numbers).toEqual(['4.25','6.00']);expect(readBidFundingDraft(client,'bob','auction')).toBeNull();
  expect(readBidFundingDraft(client,'alice','auction')).not.toHaveProperty('quoteHash');expect(readBidFundingDraft(client,'alice','auction')).not.toHaveProperty('paymentOutcome');
  clearBidFundingDraft(client,'bob','auction');expect(readBidFundingDraft(client,'alice','auction')).not.toBeNull();clearBidFundingDraft(client,'alice','auction');expect(readBidFundingDraft(client,'alice','auction')).toBeNull();
  for(let i=0;i<11;i++)retainBidFundingDraft(client,'alice','auction-'+i,draft);
  expect(client.getQueryCache().findAll({queryKey:['lowin-private','alice','bid-funding-draft']})).toHaveLength(10);
  client.removeQueries({queryKey:['lowin-private']});expect(readBidFundingDraft(client,'alice','auction-10')).toBeNull();
 });
});
