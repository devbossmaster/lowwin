import {Prisma as MoneyPrisma} from '@prisma/client';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFile,execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { bidAuction,bidUser } from './bid-fixtures';
import { submitBid,submitBidInTransaction } from '../src/modules/auctions/bids';
import { cancelAuction,cancelAuctionInTransaction,closeAuction,closeAuctionInTransaction,processDueAuction,type CancelInput } from '../src/modules/auctions/settlement';
import { reconcile } from '../src/modules/wallet/ledger';
import { adjustAuctionHold } from '../src/modules/wallet/holds';
import { seedCatalog } from '../scripts/seed-catalog';

const url=process.env.SETTLEMENT_TEST_DATABASE_URL??process.env.BID_TEST_DATABASE_URL;
describe.skipIf(!url)('atomic closing and cancellation on disposable PostgreSQL',()=>{
  let client:PrismaClient;
  beforeAll(async()=>{
    const target=new URL(url!);
    if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Settlement tests require a disposable loopback *_test database');
    Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false'});
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
    client=new PrismaClient();
    await client.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION lowin_test_fail_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('lowin.test_fail_user',true)=NEW."userId" AND (NEW.key LIKE 'settlement:%' OR NEW.scope IN ('AUCTION_WIN_CHARGE','AUCTION_FEE_REFUND')) THEN RAISE EXCEPTION 'forced participant failure'; END IF; RETURN NEW; END; $$`);
    await client.$executeRawUnsafe('CREATE TRIGGER lowin_test_fail_movement BEFORE INSERT ON "Operation" FOR EACH ROW EXECUTE FUNCTION lowin_test_fail_movement()');
  },60000);
  afterAll(async()=>{if(client){await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS lowin_test_fail_movement ON "Operation"');await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS lowin_test_fail_movement()');await client.$disconnect()}const {db}=await import('../src/lib/db');await db.$disconnect()});
  const waitDue=async(a:{endsAt:Date|null})=>{const [{now}]=await client.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;await new Promise(resolve=>setTimeout(resolve,Math.max(0,a.endsAt!.getTime()-now.getTime()+25)))};
  const bid=(userId:string,auctionSlug:string,amount:number)=>submitBid(client,{userId,auctionSlug,amount:String(amount),key:randomUUID()});
  const cancel=(auctionId:string,override:Partial<CancelInput>={}):CancelInput=>({auctionId,actor:{id:'test-owner',permission:'auction:cancel'},reason:'DEMO cancellation test',key:randomUUID(),...override});
  const balance=async(userId:string)=>{const w=await client.wallet.findUniqueOrThrow({where:{userId},include:{accounts:true}});return Object.fromEntries(w.accounts.map(a=>[a.kind,BigInt(a.balance.toString())]))};
  const snapshot=async(auctionId:string)=>({settlements:await client.auctionSettlement.count({where:{auctionId}}),journals:await client.journal.count(),operations:await client.operation.count(),outbox:await client.outbox.count(),holds:(await client.auctionHold.findMany({where:{auctionId},orderBy:{walletId:'asc'}})).map(h=>h.points)});

  it('1 twice / 2 once / 3 twice / 4 once selects 2, charges only 2 and keeps nonzero fees',async()=>{
    const a=await bidAuction(client,{fee:2,endDelayMs:2000});const u=await bidUser(client),v=await bidUser(client);
    for(const amount of [1,2,3,4])await bid(u,a.slug!,amount);
    for(const amount of [1,3])await bid(v,a.slug!,amount);
    await waitDue(a);const result=await closeAuction(client,a.id);
    expect(result.outcome).toBe('WINNER');expect(result.winnerUserId).toBe(u);expect(result.winningPoints?.toString()).toBe("2");
    expect(result.proof).toMatchObject({ruleVersion:'lowest-unique-v1',cutoff:a.endsAt!.toISOString(),acceptedCount:6,amountFrequencies:[{amount:'1',count:2},{amount:'2',count:1},{amount:'3',count:2},{amount:'4',count:1}],winner:{userId:u,amount:'2'},feePolicy:'KEEP_DISCLOSED_ENTRY_FEES'});
    expect(await balance(u)).toMatchObject({AVAILABLE:990n,HELD:0n});expect(await balance(v)).toMatchObject({AVAILABLE:996n,HELD:0n});
    expect(result.movements.find(m=>m.userId===u)).toMatchObject({holdBefore:new MoneyPrisma.Decimal("4"),chargedPoints:new MoneyPrisma.Decimal("2"),releasedPoints:new MoneyPrisma.Decimal("2"),refundedFees:new MoneyPrisma.Decimal("0")});
    expect(await reconcile(client)).toEqual([]);
  });
  it('all amounts duplicated records NO_WINNER and releases all holds while retaining fees',async()=>{
    const a=await bidAuction(client,{fee:3,endDelayMs:1400});const users=[await bidUser(client),await bidUser(client)];
    for(const user of users)for(const amount of [10,20])await bid(user,a.slug!,amount);
    await waitDue(a);const result=await closeAuction(client,a.id);
    expect(result.outcome).toBe('NO_WINNER');expect(result.winningBidId).toBeNull();
    for(const user of users)expect(await balance(user)).toMatchObject({AVAILABLE:994n,HELD:0n});
    expect(await reconcile(client)).toEqual([]);
  });
  it('zero bids records NO_WINNER and releases an existing internal hold',async()=>{
    const a=await bidAuction(client,{endDelayMs:1100}),userId=await bidUser(client);
    await adjustAuctionHold(client,{userId,auctionId:a.id,direction:'RESERVE',points:'25',key:randomUUID(),reference:'zero-bid-fixture'});
    await waitDue(a);const result=await closeAuction(client,a.id);
    expect(result).toMatchObject({outcome:'NO_WINNER',acceptedCount:0});expect(result.proof).toMatchObject({amountFrequencies:[],winner:null});
    expect(await balance(userId)).toMatchObject({AVAILABLE:1000n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  });
  it('one bid wins and numeric ordering chooses 2 before 10 for one user with several unique amounts',async()=>{
    const user=await bidUser(client),a=await bidAuction(client,{endDelayMs:1500}),single=await bidAuction(client,{endDelayMs:1500});
    for(const amount of [100,10,2])await bid(user,a.slug!,amount);
    await bid(user,single.slug!,7);await waitDue(single);
    const multi=await closeAuction(client,a.id),one=await closeAuction(client,single.id);
    expect(multi.winningPoints?.toString()).toBe("2");expect(one.winningPoints?.toString()).toBe("7");
    expect(await balance(user)).toMatchObject({AVAILABLE:991n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  });
  it('cancellation releases all holds and refunds every charged fee through compensating journals',async()=>{
    const a=await bidAuction(client,{fee:4}),users=[await bidUser(client),await bidUser(client)];
    for(const user of users)for(const amount of [5,20])await bid(user,a.slug!,amount);
    const input=cancel(a.id),result=await cancelAuction(client,input);
    expect(result.outcome).toBe('CANCELLED');expect(result.movements.map(m=>m.refundedFees.toString())).toEqual(['8','8']);
    for(const user of users)expect(await balance(user)).toMatchObject({AVAILABLE:1000n,HELD:0n});
    const before=await snapshot(a.id);expect((await cancelAuction(client,input)).id).toBe(result.id);expect(await snapshot(a.id)).toEqual(before);
    await expect(cancelAuction(client,{...input,reason:'changed reason'})).rejects.toMatchObject({code:'KEY_REUSED'});
    await expect(cancelAuction(client,cancel(a.id))).rejects.toMatchObject({code:'ALREADY_SETTLED'});
    expect(await reconcile(client)).toEqual([]);
  });
  it('requires actor permission, reason and key, and prevents cancellation or reopening after settlement',async()=>{
    const a=await bidAuction(client,{endDelayMs:500});
    await expect(cancelAuction(client,cancel(a.id,{reason:''}))).rejects.toThrow();
    await expect(cancelAuction(client,{...cancel(a.id),actor:{id:'guest',permission:'player'}} as unknown as CancelInput)).rejects.toThrow();
    await waitDue(a);await closeAuction(client,a.id);
    await expect(cancelAuction(client,cancel(a.id))).rejects.toMatchObject({code:'ALREADY_SETTLED'});
    await expect(client.auction.update({where:{id:a.id},data:{status:'LIVE'}})).rejects.toThrow();
  });
  it('rejects premature close and production DEMO settlement and freezes published schedules',async()=>{
    const a=await bidAuction(client);
    await expect(closeAuction(client,a.id)).rejects.toMatchObject({code:'NOT_DUE'});
    await expect(cancelAuction(client,cancel(a.id),{...process.env,NODE_ENV:'production'})).rejects.toMatchObject({code:'DEMO_SETTLEMENT_FORBIDDEN'});
    await expect(client.auction.update({where:{id:a.id},data:{endsAt:new Date(0)}})).rejects.toThrow();
    await cancelAuction(client,cancel(a.id));
  });
  it('concurrent workers claim due rows once and leave a durable single result and outbox',async()=>{
    const a=await bidAuction(client,{endDelayMs:800}),user=await bidUser(client);await bid(user,a.slug!,8);await waitDue(a);
    await Promise.all(Array.from({length:4},()=>processDueAuction(client)));
    const settled=await client.auctionSettlement.findUniqueOrThrow({where:{auctionId:a.id}});
    expect(await client.auctionSettlement.count({where:{auctionId:a.id}})).toBe(1);
    expect(await client.outbox.count({where:{settlementId:settled.id}})).toBe(2);
    const before=await snapshot(a.id);const replay=await Promise.all([closeAuction(client,a.id),closeAuction(client,a.id)]);
    expect(replay.every(result=>result.id===settled.id)).toBe(true);expect(await snapshot(a.id)).toEqual(before);expect(await reconcile(client)).toEqual([]);
  });
  it('settles overlapping participant wallets across auctions in stable order',async()=>{
    const a=await bidAuction(client,{endDelayMs:1600}),b=await bidAuction(client,{endDelayMs:1600}),u=await bidUser(client),v=await bidUser(client);
    await bid(u,a.slug!,10);await bid(v,a.slug!,20);await bid(v,b.slug!,10);await bid(u,b.slug!,20);await waitDue(b);
    await Promise.all([closeAuction(client,a.id),closeAuction(client,b.id)]);
    for(const user of [u,v])expect(await balance(user)).toMatchObject({AVAILABLE:990n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  });
  it('persists failed worker attempts without partial effects and recovers after retry delay',async()=>{
    const a=await bidAuction(client,{endDelayMs:800}),user=await bidUser(client);await bid(user,a.slug!,10);
    await adjustAuctionHold(client,{userId:user,auctionId:a.id,direction:'RELEASE',points:'10',key:randomUUID(),reference:'test short hold'});await waitDue(a);
    const before=await snapshot(a.id),attempt=await processDueAuction(client);
    expect(attempt).toMatchObject({status:'retry',auctionId:a.id});expect(await snapshot(a.id)).toEqual(before);
    const state=await client.auction.findUniqueOrThrow({where:{id:a.id}});expect(state.closeAttempts).toBe(1);expect(state.nextCloseAttemptAt).not.toBeNull();
    await adjustAuctionHold(client,{userId:user,auctionId:a.id,direction:'RESERVE',points:'10',key:randomUUID(),reference:'restore test hold'});
    await new Promise(resolve=>setTimeout(resolve,5100));expect(await processDueAuction(client)).toMatchObject({status:'settled',auctionId:a.id});expect(await reconcile(client)).toEqual([]);
  });
  it('process crash before commit rolls back every row and a fresh worker recovers',async()=>{
    const a=await bidAuction(client,{fee:2,endDelayMs:700}),user=await bidUser(client);await bid(user,a.slug!,12);await waitDue(a);
    const before=await snapshot(a.id);
    await expect(promisify(execFile)(process.execPath,['node_modules/tsx/dist/cli.mjs','tests/settlement-crash-worker.ts','before',a.id],{env:process.env})).rejects.toMatchObject({code:79});
    expect(await snapshot(a.id)).toEqual(before);
    const result=await closeAuction(client,a.id);expect(result.winningPoints?.toString()).toBe("12");expect(await reconcile(client)).toEqual([]);
  },30000);
  it('process crash after commit loses the acknowledgement without duplicating settlement',async()=>{
    const a=await bidAuction(client,{fee:2,endDelayMs:700}),user=await bidUser(client);await bid(user,a.slug!,12);await waitDue(a);
    await expect(promisify(execFile)(process.execPath,['node_modules/tsx/dist/cli.mjs','tests/settlement-crash-worker.ts','after',a.id],{env:process.env})).rejects.toMatchObject({code:79});
    const before=await snapshot(a.id),result=await closeAuction(client,a.id);
    expect(result.winningPoints?.toString()).toBe("12");expect(await snapshot(a.id)).toEqual(before);expect(await balance(user)).toMatchObject({AVAILABLE:986n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  },30000);
  it('forced failure midway through multiple wallets rolls back winner charge, releases and proof',async()=>{
    const a=await bidAuction(client,{fee:2,endDelayMs:1500}),users=[await bidUser(client),await bidUser(client),await bidUser(client)].sort();
    for(const [i,user] of users.entries())await bid(user,a.slug!,i+5);await waitDue(a);
    const before=await snapshot(a.id);
    await expect(client.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('lowin.test_fail_user',${users[1]},true)`;await closeAuctionInTransaction(tx,a.id)},{timeout:20000})).rejects.toThrow('forced participant failure');
    expect(await snapshot(a.id)).toEqual(before);expect(await reconcile(client)).toEqual([]);
    await closeAuction(client,a.id);expect(await reconcile(client)).toEqual([]);
  });
  it('forced failure during cancellation refunds leaves all holds and charged fees intact',async()=>{
    const a=await bidAuction(client,{fee:3}),users=[await bidUser(client),await bidUser(client)].sort();for(const user of users)await bid(user,a.slug!,20);
    const before=await snapshot(a.id),input=cancel(a.id);
    await expect(client.$transaction(async tx=>{await tx.$executeRaw`SELECT set_config('lowin.test_fail_user',${users[1]},true)`;await cancelAuctionInTransaction(tx,input)})).rejects.toThrow('forced participant failure');
    expect(await snapshot(a.id)).toEqual(before);await cancelAuction(client,input);expect(await reconcile(client)).toEqual([]);
  });
  it('a bid queued before deadline cannot enter after its auction lock is released late',async()=>{
    const a=await bidAuction(client,{endDelayMs:800}),user=await bidUser(client);
    let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),locked=new Promise<void>(resolve=>{ready=resolve});
    const blocker=client.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${a.id} FOR UPDATE`;ready();await gate},{timeout:10000});await locked;
    const before=await snapshot(a.id),pending=bid(user,a.slug!,9);const check=expect(pending).rejects.toMatchObject({code:'AUCTION_CLOSED'});
    await waitDue(a);release();await blocker;await check;expect(await snapshot(a.id)).toEqual(before);
    expect((await closeAuction(client,a.id)).outcome).toBe('NO_WINNER');expect(await reconcile(client)).toEqual([]);
  });
  it('cancellation waiting for an accepted bid includes its hold and fee refund',async()=>{
    const a=await bidAuction(client,{fee:5}),user=await bidUser(client);let release!:()=>void,ready!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve}),locked=new Promise<void>(resolve=>{ready=resolve});
    const pending=client.$transaction(async tx=>{await submitBidInTransaction(tx,{userId:user,auctionSlug:a.slug!,amount:'30',key:randomUUID()});ready();await gate},{timeout:10000});await locked;
    const cancellation=cancelAuction(client,cancel(a.id));release();await pending;const result=await cancellation;
    expect(result.acceptedCount).toBe(1);expect(await balance(user)).toMatchObject({AVAILABLE:1000n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  });
  it('a bid waiting behind cancellation rejects and close/cancel races never overwrite a result',async()=>{
    const a=await bidAuction(client,{fee:2}),user=await bidUser(client);let release!:()=>void,ready!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve}),locked=new Promise<void>(resolve=>{ready=resolve});
    const cancellation=client.$transaction(async tx=>{await cancelAuctionInTransaction(tx,cancel(a.id));ready();await gate},{timeout:10000});await locked;
    const pending=bid(user,a.slug!,15),check=expect(pending).rejects.toMatchObject({code:'AUCTION_CLOSED'});release();await cancellation;await check;
    const b=await bidAuction(client,{fee:3,endDelayMs:900});await bid(user,b.slug!,10);await waitDue(b);
    await Promise.allSettled([closeAuction(client,b.id),cancelAuction(client,cancel(b.id)),bid(user,b.slug!,11)]);
    const result=await client.auctionSettlement.findUniqueOrThrow({where:{auctionId:b.id}});
    expect(['WINNER','CANCELLED']).toContain(result.outcome);expect(await client.bid.count({where:{auctionId:b.id}})).toBe(1);
    expect(await balance(user)).toMatchObject({AVAILABLE:result.outcome==='WINNER'?987n:1000n,HELD:0n});expect(await reconcile(client)).toEqual([]);
  });
  it('private proofs and notification intents are immutable, with no amounts in public catalog or outbox',async()=>{
    const a=await bidAuction(client,{endDelayMs:900}),user=await bidUser(client);await bid(user,a.slug!,13);await waitDue(a);
    const {getAuction}=await import('../src/modules/auctions/catalog');
    const pending=await getAuction(a.slug!);expect(pending?.status).toBe('closing');expect(pending?.result).toBeNull();
    const result=await closeAuction(client,a.id);
    await expect(client.auctionSettlement.update({where:{id:result.id},data:{proof:{tampered:true}}})).rejects.toThrow();
    await expect(client.auctionSettlement.delete({where:{id:result.id}})).rejects.toThrow();
    await expect(client.settlementMovement.update({where:{id:result.movements[0].id},data:{releasedPoints:new MoneyPrisma.Decimal("99")}})).rejects.toThrow();
    const other=await bidUser(client),wallet=await client.wallet.findUniqueOrThrow({where:{userId:other}});
    await expect(client.settlementMovement.create({data:{settlementId:result.id,userId:other,walletId:wallet.id,holdBefore:new MoneyPrisma.Decimal("0"),chargedPoints:new MoneyPrisma.Decimal("0"),releasedPoints:new MoneyPrisma.Decimal("0"),refundedFees:new MoneyPrisma.Decimal("0")}})).rejects.toThrow('Cannot append movements');
    const intents=await client.outbox.findMany({where:{settlementId:result.id}});expect(JSON.stringify(intents)).not.toMatch(/amount|winningPoints|frequency|telegramId|winnerUserId/);
    await expect(client.outbox.update({where:{id:intents[0].id},data:{payload:{changed:true}}})).rejects.toThrow();
    expect(JSON.stringify(await getAuction(a.slug!))).not.toMatch(/amountFrequencies|winnerUserId|winningBidId|recipientUserId|requestHash|proof/);
    await expect(adjustAuctionHold(client,{userId:user,auctionId:a.id,direction:'RESERVE',points:'1',key:randomUUID(),reference:'after-close'})).rejects.toThrow();
  });
  it('preserves Phase 2 illustrative results byte-for-byte and never adopts them as settlement',async()=>{
    await seedCatalog(client);const before=await client.publicAuctionResult.findMany({orderBy:{id:'asc'}});
    for(const result of before){await expect(closeAuction(client,result.auctionId)).rejects.toMatchObject({code:'ILLUSTRATIVE_RESULT_PRESERVED'});await expect(cancelAuction(client,cancel(result.auctionId))).rejects.toMatchObject({code:'ILLUSTRATIVE_RESULT_PRESERVED'});}
    await seedCatalog(client);expect(await client.publicAuctionResult.findMany({orderBy:{id:'asc'}})).toEqual(before);
    expect(await client.auctionSettlement.count({where:{auctionId:{in:before.map(r=>r.auctionId)}}})).toBe(0);expect(await reconcile(client)).toEqual([]);
  });
});
