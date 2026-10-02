import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {cancelAuction,closeAuction} from '../src/modules/auctions/settlement';
import {getWalletView} from '../src/modules/wallet/view';
import {reconcile} from '../src/modules/wallet/ledger';
import {cancellationImpact} from '../src/modules/admin/operations';
import {adoptSubmissionFee} from '../src/modules/auctions/adopt-submission-fee';

const url=process.env.BID_TEST_DATABASE_URL;
describe.skipIf(!url)('submission-fee-only bidding on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();
 },60000);
 afterAll(async()=>{await db?.$disconnect()});
 const auction=(fee=30,endDelayMs=60000)=>bidAuction(db,{ruleVersion:'lowest-unique-v4',fee,endDelayMs});
 const bid=(userId:string,slug:string,amount:string,key=randomUUID(),feeVersion=1)=>submitBid(db,{userId,auctionSlug:slug,amount,key,feeVersion});
 const balance=async(userId:string)=>(await getWalletView(db,userId)).wallet;
 const due=async(a:{endsAt:Date|null})=>new Promise(r=>setTimeout(r,Math.max(0,a.endsAt!.getTime()-Date.now()+30)));
 it('charges exactly 30 for number 3.60, with no hold; replays charge only once',async()=>{
  const a=await auction(),u=await bidUser(db,'30'),key=randomUUID();
  const r=await bid(u,a.slug!,'3.60',key);expect(r.charge).toEqual({feePoints:'30',newlyUnavailable:'30'});
  expect(r.hold).toEqual({previousMax:'0',newMax:'0',extraReserved:'0'});
  expect(await bid(u,a.slug!,'3.6',key)).toEqual(r);
  expect(await balance(u)).toEqual({available:'0',held:'0'});expect(await db.auctionHold.count({where:{auctionId:a.id}})).toBe(0);
  expect(await reconcile(db)).toEqual([]);
 });
 it('rejects insufficient funds, stale or missing fee quotes and invalid numbers without charging',async()=>{
  const a=await auction(),u=await bidUser(db,'29.99');
  await expect(bid(u,a.slug!,'3.60')).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});
  await expect(bid(u,a.slug!,'3.60',randomUUID(),2)).rejects.toMatchObject({code:'RETRYABLE_CONFLICT'});
  await expect(submitBid(db,{userId:u,auctionSlug:a.slug!,amount:'3.60',key:randomUUID()})).rejects.toMatchObject({code:'RETRYABLE_CONFLICT'});
  for(const n of ['0.99','1.001'])await expect(bid(u,a.slug!,n)).rejects.toThrow();
  expect(await balance(u)).toEqual({available:'29.99',held:'0'});expect(await db.bid.count({where:{auctionId:a.id}})).toBe(0);
 });
 it('allows large chosen numbers with a small fee and rejects own duplicates',async()=>{
  const a=await auction(2.5),u=await bidUser(db,'5');await bid(u,a.slug!,'99999999.99');
  await expect(bid(u,a.slug!,'99999999.99')).rejects.toMatchObject({code:'OWN_DUPLICATE'});
  await bid(u,a.slug!,'100000000');expect(await balance(u)).toEqual({available:'0',held:'0'});
 });
 it('rolls back interrupted acceptance and concurrent overspending',async()=>{
  const a=await auction(),u=await bidUser(db,'30');const input={userId:u,auctionSlug:a.slug!,amount:'3.6',key:randomUUID(),feeVersion:1};
  await expect(db.$transaction(async tx=>{await submitBidInTransaction(tx,input);throw Error('interrupted')})).rejects.toThrow('interrupted');
  expect(await balance(u)).toEqual({available:'30',held:'0'});
  const attempts=await Promise.allSettled([bid(u,a.slug!,'3.6'),bid(u,a.slug!,'4.6')]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(await reconcile(db)).toEqual([]);
 });
 it('settles the lowest unique number without debiting it',async()=>{
  const a=await auction(30,2500),u=await bidUser(db,'60'),v=await bidUser(db,'30');
  await bid(u,a.slug!,'1');await bid(v,a.slug!,'1');const winner=await bid(u,a.slug!,'3.6');await due(a);
  const s=await closeAuction(db,a.id);expect(s.winningBidId).toBe(winner.bid.id);expect(s.decision).toBe('LOWEST_UNIQUE');
  expect(s.movements.every(m=>m.chargedPoints.isZero()&&m.refundedFees.isZero()&&m.holdBefore.isZero())).toBe(true);
  expect(await balance(u)).toEqual({available:'0',held:'0'});expect(await reconcile(db)).toEqual([]);
 });
 it('retains the earliest lowest fallback without a winning charge',async()=>{
  const a=await auction(30,2500),u=await bidUser(db,'30'),v=await bidUser(db,'30');
  const first=await bid(u,a.slug!,'3.6');await bid(v,a.slug!,'3.6');await due(a);
  const s=await closeAuction(db,a.id);expect(s.decision).toBe('FIRST_ACCEPTED_LOWEST');expect(s.winningBidId).toBe(first.bid.id);
  expect(s.movements.every(m=>m.chargedPoints.isZero())).toBe(true);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps submission fees on owner cancellation and minimum-participant cancellation',async()=>{
  for(const ownerCancel of [true,false]){
   const a=await auction(30,ownerCancel?60000:1500),u=await bidUser(db,'30');await bid(u,a.slug!,'3.6');
   expect((await db.$transaction(tx=>cancellationImpact(tx,a.id))).feeRefund).toBe('0');
   if(!ownerCancel)await due(a);
   const s=ownerCancel?await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'Test cancellation',key:randomUUID()}):await closeAuction(db,a.id);
   expect(s.outcome).toBe('CANCELLED');expect(s.movements[0].refundedFees.toString()).toBe('0');
   expect(s.proof).toMatchObject({feePolicy:'NON_REFUNDABLE_SUBMISSION_FEES',amountPolicy:{currency:'NONE'}});
   expect(await balance(u)).toEqual({available:'0',held:'0'});
  }
  expect(await reconcile(db)).toEqual([]);
 });
 it('converts a live V3 auction atomically, releases old holds and preserves receipts',async()=>{
  const a=await bidAuction(db,{ruleVersion:'lowest-unique-v3',fee:5}),u=await bidUser(db,'100');
  const original=await bid(u,a.slug!,'3.6');
  expect(await balance(u)).toEqual({available:'91.4',held:'3.6'});
  expect(await adoptSubmissionFee(db,a.code,'30')).toMatchObject({applied:false,heldEtbToRelease:'3.6'});
  expect(await balance(u)).toEqual({available:'91.4',held:'3.6'});
  expect(await adoptSubmissionFee(db,a.code,'30',true)).toMatchObject({applied:true,heldEtbToRelease:'3.6'});
  expect(await balance(u)).toEqual({available:'95',held:'0'});
  const stored=await db.operation.findFirstOrThrow({where:{scope:'BID',userId:u}});expect(stored.result).toEqual(original);
  await expect(bid(u,a.slug!,'99999')).rejects.toMatchObject({code:'RETRYABLE_CONFLICT'});
  await bid(u,a.slug!,'99999',randomUUID(),2);expect(await balance(u)).toEqual({available:'65',held:'0'});
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-owner',permission:'auction:cancel'},reason:'Check converted policy',key:randomUUID()});
  expect(await balance(u)).toEqual({available:'65',held:'0'});expect(await reconcile(db)).toEqual([]);
 });
});
