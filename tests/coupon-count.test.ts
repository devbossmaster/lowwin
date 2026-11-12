import {describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {getOwnCouponCount} from '../src/modules/referrals/coupon-count';

describe('lean owned coupon count',()=>{
 const ready={REFERRAL_REWARDS_SCHEMA_READY:'true'};
 it('uses one parameterized query with database expiry and redemption checks',async()=>{
  const query=vi.fn(async()=>[{count:3}]),client={$queryRaw:query} as unknown as PrismaClient;
  expect(await getOwnCouponCount(client,'owner-account',ready)).toEqual({configured:true,available:3});
  expect(query).toHaveBeenCalledTimes(1);
  const [sql,owner]=query.mock.calls[0] as unknown as [TemplateStringsArray,string];
  expect(owner).toBe('owner-account');expect(sql.join(' ')).toContain('clock_timestamp()');expect(sql.join(' ')).toContain('NOT EXISTS');expect(sql.join(' ')).toContain('"ownerUserId"=');expect(sql.join(' ')).not.toContain('owner-account');
 });
 it('keeps a confirmed zero distinct from an unavailable policy',async()=>{
  expect(await getOwnCouponCount({$queryRaw:vi.fn(async()=>[{count:0}])} as unknown as PrismaClient,'owner',ready)).toEqual({configured:true,available:0});
  expect(await getOwnCouponCount({$queryRaw:vi.fn(async()=>[])} as unknown as PrismaClient,'owner',ready)).toEqual({configured:false,available:null});
 });
 it('does not query an unapplied rewards schema',async()=>{
  const query=vi.fn();expect(await getOwnCouponCount({$queryRaw:query} as unknown as PrismaClient,'owner',{})).toEqual({configured:false,available:null});expect(query).not.toHaveBeenCalled();
 });
});
