import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {listCompletedWinners} from '../src/modules/auctions/results';
import {breakdownQuery,getResultBreakdown} from '../src/modules/auctions/result-breakdown';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const pinned={APP_ENV:'staging',NODE_ENV:'development',STAGING_DEMO_ENABLED:'true',DATABASE_URL:'postgresql://postgres.kgwjolbhtvfwuohrtjya@aws-1-eu-west-1.pooler.supabase.com/postgres',DIRECT_URL:'postgresql://postgres@db.kgwjolbhtvfwuohrtjya.supabase.co/postgres',MINI_APP_URL:'https://fixture.ngrok-free.dev',BETTER_AUTH_URL:'https://fixture.ngrok-free.dev',STAGING_DEMO_ORIGIN_HASH:hash('https://fixture.ngrok-free.dev'),TELEGRAM_BOT_TOKEN:'123:fixture',STAGING_DEMO_BOT_HASH:hash('123')};
const now=new Date('2026-10-24T12:00:00Z');
function environment(change:Record<string,string|undefined>={}){for(const [name,value] of Object.entries({...pinned,...change}))vi.stubEnv(name,value);vi.stubEnv('VERCEL','')}
function database(){
 const tx={$queryRaw:vi.fn().mockResolvedValue([{now}]),auction:{findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0),findFirst:vi.fn().mockResolvedValue(null)}};
 const client={$transaction:vi.fn(async(callback:(value:typeof tx)=>unknown)=>callback(tx))};
 return {tx,client:client as unknown as PrismaClient};
}
afterEach(()=>vi.unstubAllEnvs());
describe('staging result visibility keeps finality and normal exclusions',()=>{
 it('shows only committed closed winners and bounded demo fixtures in the pinned preview',async()=>{
  environment();const {tx,client}=database();await listCompletedWinners(client);
  expect(tx.auction.findMany.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([
   {OR:[{isDemo:false},{isDemo:true,isSettlementFixture:true}]},
   {status:'CLOSED',settlement:{is:{outcome:'WINNER',winningPoints:{not:null},completedAt:{lte:now},publication:{is:{publishedAt:{lte:now}}}}}},
  ]));
 });
 it('retains final settlement gating before any bid aggregates in the breakdown',async()=>{
  environment();const {tx,client}=database();expect(await getResultBreakdown(client,'DEMO-preview',breakdownQuery.parse({}))).toBeNull();
  expect(tx.auction.findFirst.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([
   {OR:[{isDemo:false},{isDemo:true,isSettlementFixture:true}]},
   {status:{in:['CLOSED','CANCELLED']},settlement:{is:{completedAt:{lte:now}}}},
  ]));
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
 });
 it.each([{NODE_ENV:'production'},{STAGING_DEMO_ENABLED:'false'},{DATABASE_URL:'postgresql://postgres.otherproject@aws-1-eu-west-1.pooler.supabase.com/postgres'}])('excludes all demos on unapproved runtime %j',async change=>{
  environment(change);const {tx,client}=database();await listCompletedWinners(client);await getResultBreakdown(client,'DEMO-preview',breakdownQuery.parse({}));
  expect(tx.auction.findMany.mock.calls[0][0].where.AND).toContainEqual({isDemo:false});
  expect(tx.auction.findFirst.mock.calls[0][0].where.AND).toContainEqual({isDemo:false});
 });
});
