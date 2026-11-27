import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {readOverviewSummary,readOverviewAuctions} from '../src/modules/admin/workspace-read';
const now=new Date('2026-11-10T10:00:00Z');
describe('progressive minimal admin Overview',()=>{
 beforeEach(()=>vi.stubEnv('CHAPA_SCHEMA_READY','true'));
 it('keeps landing counts independent of the daily receipt total',async()=>{
  const $queryRaw=vi.fn()
   .mockResolvedValueOnce([{auctions:2,players:1683,deliveries:0,newMembers:8}])
   .mockRejectedValueOnce(Error('receipt read unavailable'))
   .mockResolvedValueOnce([{count:11}]);
  const value=await readOverviewSummary({$queryRaw} as unknown as PrismaClient,{id:'owner',role:'OWNER',now});
  expect(value).toMatchObject({
   auctions:{state:'ready',count:2},players:{state:'ready',count:1683},walletPaidBids:{state:'ready',count:11},
   deliveries:{state:'ready',count:0},daily:{newMembers:{state:'ready',count:8},money:{state:'error'}},
  });
  expect($queryRaw).toHaveBeenCalledTimes(3);
  const [counts,receipts,walletBids]=$queryRaw.mock.calls.map(([query])=>query);
  expect(counts.text).not.toMatch(/Journal|Posting|LedgerAccount|biddersToday/);
  expect(counts.values).toContain('2026-11-09T21:00:00.000Z');
  expect(receipts.text).toContain('"Journal"');
  expect(receipts.text).not.toMatch(/Posting|LedgerAccount/);
  expect(receipts.values).toContain(now.toISOString());
  expect(walletBids.values).toEqual(['2026-11-09T21:00:00.000Z',now.toISOString()]);
  expect(walletBids.text).toContain('j.kind=\'BID_FEE\'');
  expect(walletBids.text).toContain('w."userId"=b."userId"');
  expect(walletBids.text).toContain('p.delta<0');
  expect(walletBids.text).toContain("c.receipt->'bids' @>");
  expect(walletBids.text).toContain('"ArifPayCheckout"');
 });
 it('does not query unauthorized information or expose an assumed zero on errors',async()=>{const $queryRaw=vi.fn().mockResolvedValue([{auctions:0}]);expect(await readOverviewSummary({$queryRaw} as unknown as PrismaClient,{id:'catalog',role:'CATALOG_MANAGER',now})).toEqual({serverNow:now.toISOString(),auctions:{state:'ready',count:0}});expect($queryRaw.mock.calls[0][0].text).not.toMatch(/"user"|ChapaCheckout|FulfillmentCase/);$queryRaw.mockRejectedValue(Error('offline'));expect((await readOverviewSummary({$queryRaw} as unknown as PrismaClient,{id:'catalog',role:'CATALOG_MANAGER',now})).auctions).toEqual({state:'error'})});
 it('retains schema gating and assignee restrictions',async()=>{vi.stubEnv('CHAPA_SCHEMA_READY','false');const $queryRaw=vi.fn().mockResolvedValue([{players:4,newMembers:1}]);const support=await readOverviewSummary({$queryRaw} as unknown as PrismaClient,{id:'support',role:'SUPPORT',now});expect(support.walletPaidBids).toEqual({state:'error'});expect(support.daily).toEqual({newMembers:{state:'ready',count:1}});expect($queryRaw).toHaveBeenCalledTimes(1);expect($queryRaw.mock.calls[0][0].text).not.toContain('ChapaCheckout');$queryRaw.mockResolvedValue([{deliveries:1}]);const delivery=await readOverviewSummary({$queryRaw} as unknown as PrismaClient,{id:'delivery-staff',role:'FULFILLMENT',now});expect(delivery.walletPaidBids).toBeUndefined();expect($queryRaw.mock.calls.at(-1)![0].values).toContain('delivery-staff')});
 it('loads just five active rows independently and rejects non-catalog callers',async()=>{const $queryRaw=vi.fn().mockResolvedValue([]),db={$queryRaw} as unknown as PrismaClient;expect(await readOverviewAuctions(db,{role:'OWNER',now})).toEqual({serverNow:now.toISOString(),items:[]});expect($queryRaw.mock.calls[0][0].text).toContain('LIMIT 5');expect($queryRaw.mock.calls[0][0].text).not.toContain('SELECT a.*');await expect(readOverviewAuctions(db,{role:'SUPPORT',now})).rejects.toThrow('permission');expect($queryRaw).toHaveBeenCalledTimes(1)});
});
