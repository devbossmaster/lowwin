import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {closeAuction,cancelAuction} from '../src/modules/auctions/settlement';
import {reconcile} from '../src/modules/wallet/ledger';
import {getWalletView} from '../src/modules/wallet/view';

const url=process.env.SETTLEMENT_TEST_DATABASE_URL??process.env.BID_TEST_DATABASE_URL;
describe.skipIf(!url)('frozen cent-level v3 on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();
 },60000);
 afterAll(async()=>{await db?.$disconnect()});
 const auction=(opts:Parameters<typeof bidAuction>[1]={})=>bidAuction(db,{ruleVersion:'lowest-unique-v3',fee:0.03,endDelayMs:2500,...opts});
 const bid=(userId:string,slug:string,amount:string,key=randomUUID())=>submitBid(db,{userId,auctionSlug:slug,amount,key});
 const due=async(a:{endsAt:Date|null})=>{await new Promise(r=>setTimeout(r,Math.max(0,a.endsAt!.getTime()-Date.now()+20)))};
 const balances=async(userId:string)=>(await getWalletView(db,userId)).wallet;
 it('accepts 1.00, 1.97 and 2.34 exactly; rejects below minimum and excess precision without debit',async()=>{
  const u=await bidUser(db,'10.25'),a=await auction({endDelayMs:60000});
  for(const value of ['0.99','0','1.971','1e2','NaN'])await expect(bid(u,a.slug!,value)).rejects.toThrow();
  expect(await balances(u)).toEqual({available:'10.25',held:'0'});
  for(const amount of ['1.00','1.97','2.34'])await bid(u,a.slug!,amount);
  expect(await balances(u)).toEqual({available:'7.82',held:'2.34'});
  expect((await getWalletView(db,u)).activity.some(a=>a.availableDelta==='-0.03')).toBe(true);
  expect(await reconcile(db)).toEqual([]);
 });
 it('rejects the fourth adjacent cent amount and later gap filling, without fees or sequence gaps',async()=>{
  const u=await bidUser(db,'10'),a=await auction({endDelayMs:60000});
  for(const amount of ['1.01','1.02','1.03'])await bid(u,a.slug!,amount);
  const before=await balances(u);
  await expect(bid(u,a.slug!,'1.04')).rejects.toMatchObject({code:'CONSECUTIVE_LIMIT'});
  expect(await balances(u)).toEqual(before);
  await bid(u,a.slug!,'1.05');
  await expect(bid(u,a.slug!,'1.04')).rejects.toMatchObject({code:'CONSECUTIVE_LIMIT'});
  const rows=await db.bid.findMany({where:{auctionId:a.id},orderBy:{acceptanceOrder:'asc'}});
  expect(rows.map(r=>r.acceptanceOrder)).toEqual([1n,2n,3n,4n]);expect(await reconcile(db)).toEqual([]);
 });
 it('serializes concurrent gap-filling bids and safely replays equivalent decimal requests',async()=>{
  const u=await bidUser(db),a=await auction({endDelayMs:60000});
  const key=randomUUID(),original=await bid(u,a.slug!,'1',key);
  expect(await bid(u,a.slug!,'1.00',key)).toEqual(original);
  await bid(u,a.slug!,'1.03');
  const attempts=await Promise.allSettled([bid(u,a.slug!,'1.01'),bid(u,a.slug!,'1.02')]);
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await db.bid.count({where:{auctionId:a.id}})).toBe(3);expect(await reconcile(db)).toEqual([]);
 });
 it('enforces the same precision, minimum and pattern against direct SQL',async()=>{
  const u=await bidUser(db),a=await auction({endDelayMs:60000});
  for(const amount of ['1.01','1.02','1.03'])await bid(u,a.slug!,amount);
  for(const value of ['1.04','0.99','1.005'])await expect(db.$executeRaw`
   INSERT INTO "Bid" (id,"userId","auctionId",amount,"termsVersion","feePoints","operationId")
   VALUES (${randomUUID()},${u},${a.id},${value}::numeric,1,0.03,${randomUUID()})
  `).rejects.toThrow();
  expect(await db.bid.count({where:{auctionId:a.id}})).toBe(3);expect(await reconcile(db)).toEqual([]);
 });
 it('charges a higher unique 2.34 ahead of a duplicated 1.97 and releases all excess holds',async()=>{
  const u=await bidUser(db,'10'),v=await bidUser(db,'10'),a=await auction();
  await bid(u,a.slug!,'1.97');await bid(v,a.slug!,'1.97');const winner=await bid(v,a.slug!,'2.34');await bid(v,a.slug!,'3.50');await due(a);
  const s=await closeAuction(db,a.id);expect(s.decision).toBe('LOWEST_UNIQUE');expect(s.winningBidId).toBe(winner.bid.id);expect(s.winningPoints?.toString()).toBe('2.34');
  expect(await balances(u)).toEqual({available:'9.97',held:'0'});expect(await balances(v)).toEqual({available:'7.57',held:'0'});
  expect(s.proof).toMatchObject({ruleVersion:'lowest-unique-v3',winner:{amount:'2.34',acceptanceOrder:'3'},amountFrequencies:[{amount:'1.97',count:2},{amount:'2.34',count:1},{amount:'3.5',count:1}]});
  expect(await reconcile(db)).toEqual([]);
 });
 it('uses first database acceptance for a cent-level fallback; concurrent workers produce one settlement',async()=>{
  const u=await bidUser(db,'10'),v=await bidUser(db,'10'),a=await auction();
  const first=await bid(u,a.slug!,'1.97');await bid(v,a.slug!,'1.97');await due(a);
  const results=await Promise.all([closeAuction(db,a.id),closeAuction(db,a.id)]);
  expect(results[0].id).toBe(results[1].id);expect(results[0].decision).toBe('FIRST_ACCEPTED_LOWEST');expect(results[0].winningBidId).toBe(first.bid.id);
  expect(await balances(u)).toEqual({available:'8',held:'0'});expect(await balances(v)).toEqual({available:'9.97',held:'0'});expect(await reconcile(db)).toEqual([]);
 });
 it('refunds every fractional fee and hold when only one participant bids',async()=>{
  const u=await bidUser(db,'10.25'),a=await auction();for(const amount of ['1.97','2.34'])await bid(u,a.slug!,amount);await due(a);
  const s=await closeAuction(db,a.id);expect(s.decision).toBe('MINIMUM_PARTICIPANTS');expect(s.movements[0].refundedFees.toString()).toBe('0.06');
  expect(await balances(u)).toEqual({available:'10.25',held:'0'});expect(await reconcile(db)).toEqual([]);
 });
 it('rolls back interrupted acceptance and retries without a second charge',async()=>{
  const u=await bidUser(db,'10.25'),a=await auction({endDelayMs:60000}),input={userId:u,auctionSlug:a.slug!,amount:'1.97',key:randomUUID()};
  await expect(db.$transaction(async tx=>{await submitBidInTransaction(tx,input);throw Error('simulated crash')})).rejects.toThrow('simulated crash');
  expect(await balances(u)).toEqual({available:'10.25',held:'0'});
  const receipt=await submitBid(db,input);expect(await submitBid(db,input)).toEqual(receipt);expect(await db.bid.count({where:{auctionId:a.id}})).toBe(1);
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'DEMO cancellation',key:randomUUID()});
  expect(await balances(u)).toEqual({available:'10.25',held:'0'});expect(await reconcile(db)).toEqual([]);
 });
 it('preserves whole-ETB v1 and v2 terms without adding the v3 pattern restriction',async()=>{
  for(const ruleVersion of ['lowest-unique-v1','lowest-unique-v2']){
   const u=await bidUser(db),a=await bidAuction(db,{ruleVersion,endDelayMs:60000});
   await expect(bid(u,a.slug!,'1.97')).rejects.toMatchObject({code:'INVALID_AMOUNT'});
   for(const amount of ['1','2','3','4'])await bid(u,a.slug!,amount);
   expect((await db.auctionTerms.findUniqueOrThrow({where:{auctionId:a.id}})).ruleVersion).toBe(ruleVersion);
  }
  expect(await reconcile(db)).toEqual([]);
 });
});
