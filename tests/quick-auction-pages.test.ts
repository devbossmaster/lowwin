import {describe,expect,it} from 'vitest';
import {mergeQuickAuctionPages,quickAuctionUrl} from '../src/lib/quick-auction-pages';
import type {listQuickAuctions} from '../src/modules/auctions/catalog';
type Batch=Awaited<ReturnType<typeof listQuickAuctions>>;
function batch(page:number,codes:string[],status:'live'|'upcoming'='live'):Batch{return {page,pageSize:10,total:23,totalPages:3,serverNow:'2026-10-26T10:00:00Z',items:codes.map(code=>({code,slug:`auction-${code}`,status,startsAt:'2026-10-26T09:00:00Z',endsAt:'2026-10-28T10:00:00Z',isDemo:false,bidCount:4,product:{title:`Product ${code}`,titleAm:null,images:[]},terms:{version:1,ruleVersion:'lowest-unique-v4',entryFeePoints:'10'}}))}}
describe('cached quick auction pages',()=>{
 it('keeps status and page in the shared cache key',()=>{expect(quickAuctionUrl('live')).toBe('/api/catalog/auctions?view=quick&status=live&page=1');expect(quickAuctionUrl('upcoming',2)).toBe('/api/catalog/auctions?view=quick&status=upcoming&page=2')});
 it('deduplicates overlapping page boundaries without changing server totals',()=>{const data=mergeQuickAuctionPages([batch(1,['1','2']),batch(2,['2','3'])],'live');expect(data?.items.map(item=>item.code)).toEqual(['1','2','3']);expect(data).toMatchObject({page:2,total:23,totalPages:3})});
 it('does not mix old live rows into Upcoming after a late response',()=>{const data=mergeQuickAuctionPages([batch(1,['1'],'upcoming'),batch(2,['2'],'live')],'upcoming');expect(data?.items.map(item=>item.code)).toEqual(['1'])});
 it('stops at a missing page instead of skipping records',()=>{const data=mergeQuickAuctionPages([batch(1,['1']),batch(3,['3'])],'live');expect(data?.items.map(item=>item.code)).toEqual(['1']);expect(data?.page).toBe(1)});
 it('waits for the first page if it was evicted',()=>{expect(mergeQuickAuctionPages([batch(2,['2'])],'live')).toBeNull()});
 it('preserves a truthful empty first page',()=>{const data=mergeQuickAuctionPages([{...batch(1,[]),total:0,totalPages:0}],'upcoming');expect(data).toMatchObject({items:[],page:1,total:0,totalPages:0})});
});
