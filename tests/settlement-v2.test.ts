import {Prisma as MoneyPrisma} from '@prisma/client';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {closeAuction,closeAuctionInTransaction,cancelAuction,processDueAuction} from '../src/modules/auctions/settlement';
import {reconcile} from '../src/modules/wallet/ledger';
const url=process.env.SETTLEMENT_TEST_DATABASE_URL??process.env.BID_TEST_DATABASE_URL;
describe.skipIf(!url)('frozen v2 on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient();
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:globalDb}=await import('../src/lib/db');await globalDb.$disconnect()});
 const auction=(options:Parameters<typeof bidAuction>[1]={})=>bidAuction(db,{ruleVersion:'lowest-unique-v2',fee:2,endDelayMs:2000,...options});
 const bid=(userId:string,slug:string,amount=1,key=randomUUID())=>submitBid(db,{userId,auctionSlug:slug,amount:String(amount),key});
 const due=async(a:{endsAt:Date|null})=>{await new Promise(r=>setTimeout(r,Math.max(0,a.endsAt!.getTime()-Date.now()+25)))};
 const balance=async(userId:string)=>Object.fromEntries((await db.ledgerAccount.findMany({where:{wallet:{userId}}})).map(a=>[a.kind,BigInt(a.balance.toString())]));
 it('zero participants cancels automatically with a durable empty proof',async()=>{
  const a=await auction({endDelayMs:200});await due(a);const s=await closeAuction(db,a.id);
  expect(s).toMatchObject({outcome:'CANCELLED',decision:'MINIMUM_PARTICIPANTS',participantCount:0,acceptanceCutoff:0n,actorId:null});
  expect(s.proof).toMatchObject({minParticipants:2,acceptanceCutoff:'0',amountFrequencies:[],winner:null,references:[]});expect(await reconcile(db)).toEqual([]);
 });
 it('multiple accepted amounts from one user count once and refund EVERY fee/hold',async()=>{
  const u=await bidUser(db),a=await auction();for(const amount of [1,2,7])await bid(u,a.slug!,amount);await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({outcome:'CANCELLED',participantCount:1,acceptedCount:3});
  expect(s.movements[0]).toMatchObject({refundedFees:new MoneyPrisma.Decimal("6"),releasedPoints:new MoneyPrisma.Decimal("7"),chargedPoints:new MoneyPrisma.Decimal("0")});expect(await balance(u)).toMatchObject({AVAILABLE:1000n,HELD:0n});
  const count=await db.journal.count();expect((await closeAuction(db,a.id)).id).toBe(s.id);expect(await db.journal.count()).toBe(count);expect(await reconcile(db)).toEqual([]);
 });
 it('two users sharing the lowest amount select its first DATABASE acceptance',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction();const first=await bid(u,a.slug!),second=await bid(v,a.slug!);await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({outcome:'WINNER',decision:'FIRST_ACCEPTED_LOWEST',winningBidId:first.bid.id,winningPoints:new MoneyPrisma.Decimal("1")});
  expect(s.proof).toMatchObject({winner:{bidId:first.bid.id,acceptanceOrder:'1'},acceptanceCutoff:'2',amountFrequencies:[{amount:'1',count:2}]});
  expect(await balance(u)).toMatchObject({AVAILABLE:997n,HELD:0n});expect(await balance(v)).toMatchObject({AVAILABLE:998n,HELD:0n});expect(second.bid.id).not.toBe(first.bid.id);expect(await reconcile(db)).toEqual([]);
 });
 it('a higher unique amount always takes priority over a duplicated lower amount',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction();await bid(u,a.slug!,1);await bid(v,a.slug!,1);const chosen=await bid(v,a.slug!,10);await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({decision:'LOWEST_UNIQUE',winningBidId:chosen.bid.id,winningPoints:new MoneyPrisma.Decimal("10")});expect(await reconcile(db)).toEqual([]);
 });
 it('fallback chooses the lowest amount even when a higher amount was accepted earlier',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction();await bid(u,a.slug!,10);await bid(v,a.slug!,10);const chosen=await bid(v,a.slug!,2);await bid(u,a.slug!,2);await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({decision:'FIRST_ACCEPTED_LOWEST',winningBidId:chosen.bid.id,winningPoints:new MoneyPrisma.Decimal("2")});expect(s.movements.find(m=>m.userId===v)).toMatchObject({chargedPoints:new MoneyPrisma.Decimal("2"),releasedPoints:new MoneyPrisma.Decimal("8"),refundedFees:new MoneyPrisma.Decimal("0")});
 });
 it('equal DB timestamps are resolved by the immutable per-auction sequence',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction();
  // Test-only timestamp collision injection. Production runtime cannot install triggers.
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION lowwin_v2_equal_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('lowwin.test_equal_time',true)<>'' THEN NEW."acceptedAt":=current_setting('lowwin.test_equal_time')::timestamp; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER zz_lowwin_equal_clock BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION lowwin_v2_equal_clock()');
  try{
   const stamp=new Date().toISOString();
   const receipts=await db.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('lowwin.test_equal_time',${stamp},true)`;return [await submitBidInTransaction(tx,{userId:v,auctionSlug:a.slug!,amount:'1',key:randomUUID()}),await submitBidInTransaction(tx,{userId:u,auctionSlug:a.slug!,amount:'1',key:randomUUID()})]});
   expect(receipts[0].bid.acceptedAt).toBe(receipts[1].bid.acceptedAt);await due(a);expect((await closeAuction(db,a.id)).winningBidId).toBe(receipts[0].bid.id);
  }finally{await db.$executeRawUnsafe('DROP TRIGGER zz_lowwin_equal_clock ON "Bid"');await db.$executeRawUnsafe('DROP FUNCTION lowwin_v2_equal_clock()')}
 });
 it('concurrent bids receive a contiguous unique order and concurrent closes settle once',async()=>{
  const users=await Promise.all(Array.from({length:6},()=>bidUser(db))),a=await auction({endDelayMs:3500});
  await Promise.all(users.map(u=>bid(u,a.slug!,3)));const ordered=await db.bid.findMany({where:{auctionId:a.id},orderBy:{acceptanceOrder:'asc'}});
  expect(ordered.map(b=>b.acceptanceOrder)).toEqual([1n,2n,3n,4n,5n,6n]);await due(a);
  const results=await Promise.all([closeAuction(db,a.id),closeAuction(db,a.id),closeAuction(db,a.id)]);expect(new Set(results.map(s=>s.id)).size).toBe(1);expect(results[0].winningBidId).toBe(ordered[0].id);expect(await reconcile(db)).toEqual([]);
 });
 it('bid rollback/retry does not consume acceptance order and close rollback leaves no partial finances',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction(),key=randomUUID();
  await expect(db.$transaction(async tx=>{await submitBidInTransaction(tx,{userId:u,auctionSlug:a.slug!,amount:'1',key});throw Error('simulated crash')})).rejects.toThrow('simulated crash');
  const first=await bid(u,a.slug!,1,key);await bid(v,a.slug!);expect((await db.bid.findUniqueOrThrow({where:{id:first.bid.id}})).acceptanceOrder).toBe(1n);await due(a);
  const count=await db.journal.count();await expect(db.$transaction(async tx=>{await closeAuctionInTransaction(tx,a.id);throw Error('simulated close crash')})).rejects.toThrow('simulated close crash');
  expect(await db.journal.count()).toBe(count);expect(await db.auctionSettlement.findUnique({where:{auctionId:a.id}})).toBeNull();expect((await closeAuction(db,a.id)).winningBidId).toBe(first.bid.id);expect(await reconcile(db)).toEqual([]);
 });
 it('a bid waiting for the auction lock past the deadline cannot change participant minimum',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction({endDelayMs:600});await bid(u,a.slug!);
  let locked!:()=>void;const ready=new Promise<void>(r=>locked=r);
  const lock=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${a.id} FOR UPDATE`;locked();await tx.$executeRaw`SELECT pg_sleep(0.8)`});await ready;
  await expect(bid(v,a.slug!)).rejects.toMatchObject({code:'AUCTION_CLOSED'});await lock;expect((await closeAuction(db,a.id)).decision).toBe('MINIMUM_PARTICIPANTS');expect(await reconcile(db)).toEqual([]);
 });
 it('published v1 zero/one/no-unique behavior and legacy proofs remain unchanged',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await bidAuction(db,{fee:2,endDelayMs:1000});await bid(u,a.slug!);await bid(v,a.slug!);await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({ruleVersion:'lowest-unique-v1',outcome:'NO_WINNER',decision:null});expect(s.proof).not.toHaveProperty('acceptanceCutoff');
  expect(await db.bid.findMany({where:{auctionId:a.id},select:{acceptanceOrder:true}})).toEqual([{acceptanceOrder:null},{acceptanceOrder:null}]);expect(await balance(u)).toMatchObject({AVAILABLE:998n,HELD:0n});
 });
 it('frozen minimum, sequence, bids and proof cannot be edited; direct SQL wrong winner is rejected',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction();const first=await bid(u,a.slug!),other=await bid(v,a.slug!);
  await expect(db.auctionTerms.update({where:{auctionId:a.id},data:{minParticipants:1}})).rejects.toThrow();await expect(db.auction.update({where:{id:a.id},data:{bidSequence:99n}})).rejects.toThrow();
  await expect(db.bid.update({where:{id:first.bid.id},data:{acceptanceOrder:9n}})).rejects.toThrow();await due(a);
  await expect(db.$transaction(async tx=>{await tx.auction.update({where:{id:a.id},data:{status:'CLOSED'}});await tx.auctionSettlement.create({data:{auctionId:a.id,ruleVersion:'lowest-unique-v2',termsVersion:1,cutoff:a.endsAt!,acceptedCount:2,participantCount:2,acceptanceCutoff:2n,decision:'FIRST_ACCEPTED_LOWEST',outcome:'WINNER',winningBidId:other.bid.id,winnerUserId:v,winningPoints:new MoneyPrisma.Decimal("1"),proof:{}}})})).rejects.toThrow(/frozen v2 decision/);
  const s=await closeAuction(db,a.id);await expect(db.auctionSettlement.update({where:{id:s.id},data:{proof:{}}})).rejects.toThrow();expect(await reconcile(db)).toEqual([]);
 });
 it('owner cancellation before the deadline refunds all fees and cannot pick a winner',async()=>{
  const u=await bidUser(db),v=await bidUser(db),a=await auction({endDelayMs:60000});await bid(u,a.slug!,5);await bid(v,a.slug!,6);
  const command={auctionId:a.id,actor:{id:'fixture-owner',permission:'auction:cancel' as const},reason:'DEMO investigation',key:randomUUID()};const s=await cancelAuction(db,command);
  expect(s).toMatchObject({decision:'OWNER_CANCELLED',outcome:'CANCELLED',winningBidId:null});expect((await cancelAuction(db,command)).id).toBe(s.id);for(const id of [u,v])expect(await balance(id)).toMatchObject({AVAILABLE:1000n,HELD:0n});expect(await db.outbox.count({where:{settlementId:s.id}})).toBe(0);expect(await db.notificationInbox.count({where:{key:{startsWith:`settlement:${s.id}:`}}})).toBe(0);expect(await reconcile(db)).toEqual([]);
 });
 it('scheduled workers perform minimum cancellation idempotently',async()=>{
  const a=await auction({endDelayMs:200});await due(a);await Promise.all([processDueAuction(db),processDueAuction(db)]);const s=await db.auctionSettlement.findUniqueOrThrow({where:{auctionId:a.id}});expect(s).toMatchObject({decision:'MINIMUM_PARTICIPANTS'});expect(await db.outbox.count({where:{settlementId:s.id}})).toBe(0);
 });
 it('one accepted bid cancels and direct SQL cannot force a winner below the minimum',async()=>{
  const u=await bidUser(db),a=await auction();const receipt=await bid(u,a.slug!,4);await due(a);
  await expect(db.$transaction(async tx=>{
   await tx.auction.update({where:{id:a.id},data:{status:'CLOSED'}});
   await tx.auctionSettlement.create({data:{auctionId:a.id,ruleVersion:'lowest-unique-v2',termsVersion:1,cutoff:a.endsAt!,acceptedCount:1,participantCount:1,acceptanceCutoff:1n,decision:'LOWEST_UNIQUE',outcome:'WINNER',winningBidId:receipt.bid.id,winnerUserId:u,winningPoints:new MoneyPrisma.Decimal("4"),proof:{}}});
  })).rejects.toThrow(/minimum requires cancellation/);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({decision:'MINIMUM_PARTICIPANTS',winningBidId:null});expect(await balance(u)).toMatchObject({AVAILABLE:1000n,HELD:0n});
 });
 it('direct SQL cannot invent proof financial references even with the right outcome',async()=>{
  const a=await auction({endDelayMs:200});await due(a);const id=randomUUID();
  await expect(db.$transaction(async tx=>{
   await tx.auction.update({where:{id:a.id},data:{status:'CANCELLED'}});
   await tx.auctionSettlement.create({data:{id,auctionId:a.id,ruleVersion:'lowest-unique-v2',termsVersion:1,cutoff:a.endsAt!,acceptedCount:0,participantCount:0,acceptanceCutoff:0n,decision:'MINIMUM_PARTICIPANTS',reason:'MINIMUM_PARTICIPANTS',outcome:'CANCELLED',proof:{ruleVersion:'lowest-unique-v2',termsVersion:1,minParticipants:2,participantCount:0,acceptanceCutoff:'0',acceptedCount:0,outcome:'CANCELLED',decision:'MINIMUM_PARTICIPANTS',settlementId:id,cutoff:a.endsAt!.toISOString(),feePolicy:'REFUND_ALL_ENTRY_FEES',amountFrequencies:[],winner:null,references:[{userId:'invented',chargeJournalId:'invented'}]}}});
  })).rejects.toThrow(/financial references mismatch/);
  expect(await db.auctionSettlement.findUnique({where:{auctionId:a.id}})).toBeNull();await closeAuction(db,a.id);expect(await reconcile(db)).toEqual([]);
 });
 it('restricted non-owner runtime can bid and settle, but cannot disable guards or read migrations',async()=>{
  const pg=new Client({connectionString:url});await pg.connect();try{await pg.query(readFileSync('deploy/runtime-role.sql','utf8'))}finally{await pg.end()}
  const u=await bidUser(db),v=await bidUser(db),a=await auction();
  for(const userId of [u,v])await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');await submitBidInTransaction(tx,{userId,auctionSlug:a.slug!,amount:'1',key:randomUUID()})});
  await due(a);const s=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');return closeAuctionInTransaction(tx,a.id)});
  expect(s).toMatchObject({decision:'FIRST_ACCEPTED_LOWEST',winnerUserId:u});
  for(const sql of ['ALTER TABLE "Bid" DISABLE TRIGGER ALL','TRUNCATE "Journal" CASCADE','SELECT * FROM "_prisma_migrations"'])await expect(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');await tx.$queryRawUnsafe(sql)})).rejects.toThrow();
  expect(await reconcile(db)).toEqual([]);
 });
});
