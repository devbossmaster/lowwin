import {describe,expect,it} from 'vitest';
import {MINI_QUERY_POLICIES,miniQueryPolicy,matchesPrivateResource} from '../src/components/mini-query-policy';
import {catalogBatchUrl,winnersQueryUrl} from '../src/lib/catalog-query';
import {quickAuctionResource} from '../src/components/quick-auction-query';
import {seedPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';

describe('Mini App resource contracts',()=>{
 it('reuses a matching Home batch in compact browsing, without crossing filters or identities',()=>{
  setPrivateQueryIdentity('a');
  try{
   const query={status:'live',sort:'code',page:1,q:''} as const,url=catalogBatchUrl(query);
   seedPrivateQuery('a',catalogBatchUrl({...query,q:'phone'}),{items:[]});expect(quickAuctionResource('a','live')).toContain('view=quick');
   seedPrivateQuery('a',url,{items:[]});expect(quickAuctionResource('a','live')).toBe(url);
   expect(quickAuctionResource('a','live',2)).toContain('view=quick');expect(quickAuctionResource('a','upcoming')).toContain('view=quick');
   setPrivateQueryIdentity('b');expect(quickAuctionResource('b','live')).toContain('view=quick');
  }finally{setPrivateQueryIdentity(null)}
 });
 it('gives live financial data shorter finite freshness than immutable results',()=>{
  expect(miniQueryPolicy('/api/wallet').staleMs).toBeLessThan(miniQueryPolicy('/api/results/42/breakdown?page=1').staleMs);
  for(const policy of Object.values(MINI_QUERY_POLICIES)){expect(Number.isFinite(policy.staleMs)).toBe(true);expect(policy.retainMs).toBeGreaterThan(policy.staleMs)}
  expect(miniQueryPolicy('/api/wallet').refreshOnResume).toBe(true);expect(miniQueryPolicy('/api/catalog/auctions/item').refreshOnResume).toBe(true);
 });
 it('shares matching catalog projections without mixing status or filtered pages',()=>{
  const query={status:'live',sort:'code',page:1,q:'phone',category:'electronics'} as const;
  expect(catalogBatchUrl(query)).toBe(catalogBatchUrl({...query,page:2},1));
  expect(catalogBatchUrl(query,2)).not.toBe(catalogBatchUrl(query,1));
  expect(catalogBatchUrl({...query,status:'upcoming'})).not.toBe(catalogBatchUrl(query));
  expect(winnersQueryUrl()).toBe(winnersQueryUrl(1));
 });
 it('invalidates an exact resource family without overmatching similar slugs',()=>{
  expect(matchesPrivateResource('/api/auctions/phone/bids?page=2#language=am','/api/auctions/phone')).toBe(true);
  expect(matchesPrivateResource('/api/auctions/phone-case/bids','/api/auctions/phone')).toBe(false);
  expect(matchesPrivateResource('/api/results/winners?page=1','/api/wallet')).toBe(false);
 });
});
