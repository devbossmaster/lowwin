import {describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {activeTask,adminAreas,areaLanding,allowedTasks} from '../src/modules/admin/navigation';
import {auctionStatusWhere,eatDayStart,readOverview,overviewDeposits,overviewPlayers} from '../src/modules/admin/workspace-read';
import {draftBodySchema} from '../src/modules/admin/operations';
import {centsToEtb,etbToCents} from '../src/lib/admin-money';

describe('Admin workspace contracts',()=>{
 it('keeps exactly five primary business areas and private test auctions out of ordinary queues',()=>{
  expect(adminAreas).toEqual(['Overview','Auctions','Money','People','Settings']);
  expect(auctionStatusWhere('',new Date())).toMatchObject({testRunId:null});
  expect(auctionStatusWhere('LIVE',new Date())).toMatchObject({testRunId:null});
  expect(auctionStatusWhere('IN_PROGRESS',new Date())).toMatchObject({testRunId:null,status:{in:['SCHEDULED','LIVE']},settlement:{is:null}});
  expect(auctionStatusWhere('CANCELLED',new Date())).toMatchObject({testRunId:null,status:'CANCELLED'});
 });
 it('lands every staff role on its first authorized task',()=>{
  expect(allowedTasks('OWNER').some(t=>t.href==='/admin/content')).toBe(false);
  expect(areaLanding('OWNER','Auctions')).toBe('/admin/auctions');
  expect(areaLanding('CATALOG_MANAGER','Auctions')).toBe('/admin/auctions');
  expect(areaLanding('SUPPORT','People')).toBe('/admin/users');
  expect(areaLanding('FULFILLMENT','People')).toBe('/admin/fulfillment');
  expect(areaLanding('PAYMENTS_OPERATOR','Money')).toBe('/admin/top-ups');
  expect(areaLanding('AUDITOR','Auctions')).toBe('/admin/results');
  expect(areaLanding('AUDITOR','Overview')).toBe('/admin');
  expect(areaLanding('FULFILLMENT','Money')).toBeUndefined();
  expect(allowedTasks('SUPPORT').some(t=>t.href==='/admin/top-ups/statements')).toBe(false);
  expect(allowedTasks('OWNER').some(t=>t.href==='/admin/support')).toBe(false);
  expect(allowedTasks('OWNER').some(t=>t.href==='/admin/notifications')).toBe(true);
 });
 it('matches deep routes before their parent',()=>{
  expect(activeTask('/admin/settings/payments').area).toBe('Money');
  expect(allowedTasks('OWNER').filter(t=>t.area==='Money').map(t=>t.label)).toEqual(['Deposits','Receiving accounts']);
  expect(activeTask('/admin/top-ups/example').label).toBe('Deposits');
  expect(activeTask('/admin/auctions/example/proof').label).toBe('Results');
 });
 it('keeps a failed queue distinct from an empty authorized queue',async()=>{
  const db={topUpIntent:{count:vi.fn().mockRejectedValue(Error('offline'))},supportCase:{count:vi.fn().mockResolvedValue(0)}};
  const result=await readOverview(db as unknown as PrismaClient,{id:'support',role:'SUPPORT',now:new Date('2026-09-30T10:00:00Z')});
  expect(result).toEqual({serverNow:'2026-09-30T10:00:00.000Z',payments:{state:'error'},players:{state:'error'}});
  expect(db.supportCase.count).not.toHaveBeenCalled();
 });
 it('uses midnight EAT across UTC date and year boundaries',()=>{
  expect(eatDayStart(new Date('2026-10-02T20:59:59Z')).toISOString()).toBe('2026-10-01T21:00:00.000Z');
  expect(eatDayStart(new Date('2026-10-02T21:00:00Z')).toISOString()).toBe('2026-10-02T21:00:00.000Z');
  expect(eatDayStart(new Date('2026-12-31T22:00:00Z')).toISOString()).toBe('2026-12-31T21:00:00.000Z');
 });
 it('keeps exact deposit totals and binds the reporting time',async()=>{
  const now=new Date('2026-10-02T22:00:00Z'),$queryRaw=vi.fn().mockResolvedValue([{totalEtb:'9007199254740993.97',todayEtb:'1.97',count:4}]);
  expect(await overviewDeposits({$queryRaw} as unknown as PrismaClient,now)).toEqual({state:'ready',totalEtb:'9007199254740993.97',todayEtb:'1.97',count:4});
  const sql=$queryRaw.mock.calls[0][0];
  expect(sql.values).toEqual([eatDayStart(now),now]);
  expect(sql.text).toContain('t.status=\'CREDITED\'');expect(sql.text).toContain('t."caseState"<>\'REVERSED\'');
  expect(sql.text).toContain('"StaffMember"');expect(sql.text).toContain('"TestRunActor"');
 });
 it('counts distinct real bidders and real registrations using the same EAT day',async()=>{
  const now=new Date('2026-10-02T22:00:00Z'),$queryRaw=vi.fn().mockResolvedValue([{total:12,today:3,biddersToday:2}]);
  expect(await overviewPlayers({$queryRaw} as unknown as PrismaClient,now)).toEqual({state:'ready',total:12,today:3,biddersToday:2});
  const sql=$queryRaw.mock.calls[0][0];expect(sql.values).toEqual([eatDayStart(now),eatDayStart(now),now,now]);
  expect(sql.text).toContain('COUNT(DISTINCT b."userId")');expect(sql.text).toContain('NOT a."isDemo"');
 });
 it('does not load money or player totals for catalog staff',async()=>{
  const $queryRaw=vi.fn(),db={$queryRaw,auction:{findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)},category:{findMany:vi.fn().mockResolvedValue([])}};const result=await readOverview(db as unknown as PrismaClient,{id:'catalog',role:'CATALOG_MANAGER',now:new Date()});
  expect(result.deposits).toBeUndefined();expect(result.players).toBeUndefined();expect($queryRaw).not.toHaveBeenCalled();
 });
 it('lets support see player totals without exposing deposit amounts',async()=>{
  const db={topUpIntent:{count:vi.fn().mockResolvedValue(0)},supportCase:{count:vi.fn().mockResolvedValue(1)},$queryRaw:vi.fn().mockResolvedValue([{total:8,today:2,biddersToday:3}])};
  const result=await readOverview(db as unknown as PrismaClient,{id:'support',role:'SUPPORT',now:new Date()});
  expect(result.players).toEqual({state:'ready',total:8,today:2,biddersToday:3});expect(result.deposits).toBeUndefined();expect(db.$queryRaw).toHaveBeenCalledTimes(1);
 });
 it('converts ETB to exact cents without floating point or silent rounding',()=>{
  expect(etbToCents('1.97')).toBe('197');expect(etbToCents('2.34')).toBe('234');expect(etbToCents('999999999.99')).toBe('99999999999');
  expect(centsToEtb('99999999999')).toBe('999999999.99');expect(centsToEtb('-101')).toBe('-1.01');
  for(const s of ['1.001','-1','1e3','NaN',''])expect(()=>etbToCents(s)).toThrow();
 });
 it('freezes explicit deadline-change limits when a draft is published',()=>{
  const draft=draftBodySchema.parse({productId:'00000000-0000-4000-8000-000000000000',startsAt:'2026-10-01T10:00:00.000Z',endsAt:'2026-10-02T10:00:00.000Z',minPoints:'1.00',maxPoints:'100.00',stepPoints:'0.01',entryFeePoints:'2.50',fulfillmentSummary:'Owner delivery',fulfillmentRegion:'Addis Ababa',featured:false});
  expect(draft).toMatchObject({maxExtensionMinutes:10080,allowPaidShortening:false,shortenNoticeMinutes:1440});
 });
});
