import {Prisma as MoneyPrisma} from '@prisma/client';
import {verifyFixtureContact} from './contact-fixtures';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomInt,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bidAuction,bidUser } from './bid-fixtures';
import { signedLaunch,TEST_TOKEN } from './helpers';
import { reconcile } from '../src/modules/wallet/ledger';
import { demoBidAllowed,submitBid,submitBidInTransaction } from '../src/modules/auctions/bids';

// Separate from Phase 2's fixed-schedule catalog test database: Bid rows are
// immutable, and fresh published fixtures must never contaminate seed counts.
const url=process.env.BID_TEST_DATABASE_URL;
describe.skipIf(!url)('authenticated point bids on disposable PostgreSQL',()=>{
  let client:PrismaClient,userId:string,auction:Awaited<ReturnType<typeof bidAuction>>;
  beforeAll(async()=>{
    const target=new URL(url!);
    if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Bid tests require a disposable loopback *_test database');
    Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two'});
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
    client=new PrismaClient();
  },60000);
  beforeEach(async()=>{userId=await bidUser(client);auction=await bidAuction(client)});
  afterAll(async()=>{await client?.$disconnect();const {db}=await import('../src/lib/db');await db.$disconnect()});
  const command=(amount:string,key=randomUUID(),id=userId,slug=auction.slug!)=>({userId:id,auctionSlug:slug,amount,key});
  const counts=async()=>({bids:await client.bid.count({where:{auctionId:auction.id}}),operations:await client.operation.count({where:{userId,scope:'BID'}}),holds:await client.auctionHold.count({where:{auctionId:auction.id}})});

  it('authenticates signed Telegram sessions and rejects guest POST/GET',async()=>{
    const route=await import('../src/app/api/auctions/[slug]/bids/route');
    const context={params:Promise.resolve({slug:auction.slug!})};
    const url=`http://localhost:3000/api/auctions/${auction.slug}/bids`;
    const request=(cookie?:string)=>new Request(url,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({amount:'12',key:randomUUID(),feeVersion:1})});
    expect((await route.POST(request(),context)).status).toBe(401);
    expect((await route.GET(new Request(url),context)).status).toBe(401);
    const {handleAuth}=await import('../src/modules/auth/handler');
    const telegramId=randomInt(3000000000,4000000000);
    await verifyFixtureContact(client,telegramId);
    const signin=await handleAuth(new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Bid signer'})})})}));
    expect(signin.status).toBe(200);
    const cookie=signin.headers.get('set-cookie')!.split(';')[0];
    const signedUser=await client.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
    const {creditDevelopmentPoints}=await import('../src/modules/wallet/ledger');
    await creditDevelopmentPoints(client,signedUser.id,'100',`signed-bid-${randomUUID()}`);
    const forged=await route.POST(new Request(url,{method:'POST',headers:{cookie,origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({amount:'12',key:randomUUID(),feePoints:'0',balance:'99999',acceptedAt:'2000-01-01'})}),context);
    expect((await route.POST(new Request(url,{method:'POST',headers:{cookie,origin:'https://other.invalid'},body:'{}'}),context)).status).toBe(403);
    expect(forged.status).toBe(410);
    const response=await route.POST(request(cookie),context);
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body=await response.json();expect(body.code).toBe('ARIFPAY_REQUIRED');expect(await client.bid.count({where:{auctionId:auction.id}})).toBe(0);
    const state=await route.GET(new Request(url,{headers:{cookie}}),context);
    expect(state.status).toBe(200);expect(state.headers.get('cache-control')).toContain('no-store');
    const stateBody=await state.json();expect(stateBody.ownBids).toEqual([]);expect(stateBody).not.toHaveProperty('wallet');expect(stateBody.paymentMode).toBe('LEGACY_READ_ONLY');
    const walletRoute=await import('../src/app/api/wallet/route');
    expect((await walletRoute.GET(new Request('http://localhost:3000/api/wallet'))).status).toBe(401);
    const walletResponse=await walletRoute.GET(new Request('http://localhost:3000/api/wallet',{headers:{cookie}}));
    expect(walletResponse.status).toBe(200);expect(walletResponse.headers.get('cache-control')).toContain('private, no-store');expect(walletResponse.headers.get('vary')).toBe('Cookie');
    expect(await walletResponse.json()).toMatchObject({available:'100',held:'0'});
    const {getWalletView}=await import('../src/modules/wallet/view');expect((await getWalletView(client,signedUser.id)).wallet).toEqual({available:'100',held:'0'});
    const personalRoute=await import('../src/app/api/my-bids/route');
    expect((await personalRoute.GET(new Request('http://localhost:3000/api/my-bids'))).status).toBe(401);
    const personal=await personalRoute.GET(new Request('http://localhost:3000/api/my-bids',{headers:{cookie}}));
    expect(personal.status).toBe(200);expect(personal.headers.get('cache-control')).toContain('no-store');
    const personalBody=await personal.json();expect(personalBody.items).toEqual([]);
  },30000);
  it('enforces integer range, step and immutable accepted rows',async()=>{
    const stepped=await bidAuction(client,{min:5,max:25,step:5});
    for(const amount of ['0','-5','5.5','26','6'])await expect(submitBid(client,command(amount,randomUUID(),userId,stepped.slug!))).rejects.toThrow();
    const receipt=await submitBid(client,command('10',randomUUID(),userId,stepped.slug!));
    const row=await client.bid.findUniqueOrThrow({where:{id:receipt.bid.id}});
    expect(row.amount?.toString()).toBe("10");expect(row.termsVersion).toBe(1);expect(row.feePoints.toString()).toBe('0');
    await expect(client.bid.update({where:{id:row.id},data:{amount:new MoneyPrisma.Decimal("15")}})).rejects.toThrow();
    await expect(client.bid.delete({where:{id:row.id}})).rejects.toThrow();
  });
  it('rejects own duplicate but allows the same amount from another user',async()=>{
    await submitBid(client,command('17'));
    await expect(submitBid(client,command('17'))).rejects.toMatchObject({code:'OWN_DUPLICATE'});
    const other=await bidUser(client);
    const second=await submitBid(client,command('17',randomUUID(),other));
    expect(second.bid.amount).toBe('17');expect((await counts()).bids).toBe(2);
  });
  it('allows 100 distinct amounts per user and rejects the 101st, without capping the auction globally',async()=>{
    for(let amount=1;amount<=100;amount++)await submitBid(client,command(String(amount)));
    expect((await counts()).bids).toBe(100);
    await expect(submitBid(client,command('101'))).rejects.toMatchObject({code:'CAP_REACHED'});
    const other=await bidUser(client);
    await submitBid(client,command('101',randomUUID(),other));
    expect((await counts()).bids).toBe(101);
    expect((await client.auction.findUniqueOrThrow({where:{id:auction.id}})).acceptedBidCount).toBe(101);
  },120000);
  it('charges each fee and reserves only increases above the previous maximum',async()=>{
    const priced=await bidAuction(client,{fee:3});
    const first=await submitBid(client,command('40',randomUUID(),userId,priced.slug!));
    const lower=await submitBid(client,command('30',randomUUID(),userId,priced.slug!));
    const higher=await submitBid(client,command('70',randomUUID(),userId,priced.slug!));
    expect(first.hold).toEqual({previousMax:'0',newMax:'40',extraReserved:'40'});
    expect(lower.hold).toEqual({previousMax:'40',newMax:'40',extraReserved:'0'});
    expect(higher.hold).toEqual({previousMax:'40',newMax:'70',extraReserved:'30'});
    expect(higher.charge).toEqual({feePoints:'3',newlyUnavailable:'33'});
    expect(higher.wallet).toEqual({available:'921',held:'70'});
    expect(await client.journal.count({where:{kind:'BID_FEE',operation:{userId}}})).toBe(3);
    expect(await client.journal.count({where:{kind:'HOLD_RESERVE',operation:{userId}}})).toBe(2);
    expect(await reconcile(client)).toEqual([]);
  });
  it('rejects insufficient available points without any partial bid, hold or fee',async()=>{
    const poor=await bidUser(client,'50'),priced=await bidAuction(client,{fee:3});
    await expect(submitBid(client,command('50',randomUUID(),poor,priced.slug!))).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});
    expect(await client.bid.count({where:{auctionId:priced.id,userId:poor}})).toBe(0);
    expect(await client.auctionHold.count({where:{auctionId:priced.id}})).toBe(0);
    expect(await client.operation.count({where:{userId:poor,scope:'BID'}})).toBe(0);
    expect(await reconcile(client)).toEqual([]);
  });
  it('replays identical keys and rejects changed input without a second debit',async()=>{
    const key=randomUUID(),priced=await bidAuction(client,{fee:2});
    const first=await submitBid(client,command('20',key,userId,priced.slug!));
    expect(await submitBid(client,command('20',key,userId,priced.slug!))).toEqual(first);
    await expect(submitBid(client,command('21',key,userId,priced.slug!))).rejects.toMatchObject({code:'KEY_REUSED'});
    expect(await client.bid.count({where:{auctionId:priced.id,userId}})).toBe(1);
    expect(await client.journal.count({where:{operation:{userId},kind:'BID_FEE'}})).toBe(1);
    expect(await reconcile(client)).toEqual([]);
  });
  it('replays an accepted receipt after the auction deadline',async()=>{
    const short=await bidAuction(client,{endDelayMs:1100,fee:1});
    const key=randomUUID(),first=await submitBid(client,command('16',key,userId,short.slug!));
    await new Promise(resolve=>setTimeout(resolve,1200));
    expect(await submitBid(client,command('16',key,userId,short.slug!))).toEqual(first);
    await expect(submitBid(client,command('17',key,userId,short.slug!))).rejects.toMatchObject({code:'KEY_REUSED'});
    expect(await client.bid.count({where:{auctionId:short.id}})).toBe(1);
  },15000);
  it('serializes concurrent retries and distinct bids without double holds',async()=>{
    const key=randomUUID();const repeated=await Promise.all(Array.from({length:4},()=>submitBid(client,command('25',key))));
    expect(repeated.every(item=>item.bid.id===repeated[0].bid.id)).toBe(true);
    const distinct=await Promise.all([submitBid(client,command('40')),submitBid(client,command('60'))]);
    expect(distinct).toHaveLength(2);
    expect((await counts()).bids).toBe(3);
    const wallet=await client.wallet.findUniqueOrThrow({where:{userId},include:{accounts:true,holds:{where:{auctionId:auction.id}}}});
    expect(wallet.holds[0].points?.toString()).toBe("60");
    expect(wallet.accounts.find(item=>item.kind==='AVAILABLE')?.balance?.toString()).toBe("940");
    expect(await reconcile(client)).toEqual([]);
  },45000);
  it('rolls back a bid, reserve and immutable operation if its outer transaction fails',async()=>{
    const priced=await bidAuction(client,{fee:4});
    await expect(client.$transaction(async tx=>{await submitBidInTransaction(tx,command('29',randomUUID(),userId,priced.slug!));throw new Error('test failure after bid');})).rejects.toThrow('test failure after bid');
    expect(await client.bid.count({where:{auctionId:priced.id}})).toBe(0);
    expect(await client.auctionHold.count({where:{auctionId:priced.id}})).toBe(0);
    expect(await client.operation.count({where:{userId,scope:'BID'}})).toBe(0);
    expect(await client.journal.count({where:{operation:{userId},kind:'BID_FEE'}})).toBe(0);
    expect((await client.auction.findUniqueOrThrow({where:{id:priced.id}})).acceptedBidCount).toBe(0);
    expect(await reconcile(client)).toEqual([]);
  });
  it('rejects DEMO inventory in production settings without writing',async()=>{
    expect(demoBidAllowed({...process.env,NODE_ENV:'production'})).toBe(false);
    await expect(submitBid(client,command('15'),{...process.env,NODE_ENV:'production'})).rejects.toMatchObject({code:'DEMO_UNAVAILABLE'});
    expect((await counts()).bids).toBe(0);
  });
  it('rejects a queued bid whose auction lock is granted after the deadline',async()=>{
    const short=await bidAuction(client,{endDelayMs:1700});
    let release!:()=>void,locked!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve});const lockReady=new Promise<void>(resolve=>{locked=resolve});
    const blocker=client.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${short.id} FOR UPDATE`;locked();await gate},{timeout:10000});
    await lockReady;
    let settled=false;
    const pending=submitBid(client,command('19',randomUUID(),userId,short.slug!));pending.then(()=>{settled=true},()=>{settled=true});
    await new Promise(resolve=>setTimeout(resolve,250));expect(settled).toBe(false);
    await new Promise(resolve=>setTimeout(resolve,1750));release();await blocker;
    await expect(pending).rejects.toMatchObject({code:'AUCTION_CLOSED'});
    expect(await client.bid.count({where:{auctionId:short.id}})).toBe(0);
    expect(await client.journal.count({where:{operation:{userId},reference:{contains:short.id}}})).toBe(0);
    expect(await reconcile(client)).toEqual([]);
  },30000);
  it('keeps real accepted bids and user identities out of the public catalog',async()=>{
    await submitBid(client,command('137'));
    const {GET}=await import('../src/app/api/catalog/auctions/[slug]/route');
    const response=await GET(new Request(`http://localhost:3000/api/catalog/auctions/${auction.slug}`),{params:Promise.resolve({slug:auction.slug!})});
    expect(response.status).toBe(200);
    const body=await response.json(),json=JSON.stringify(body);
    expect(body.result).toBeNull();
    expect(json).not.toContain(userId);expect(json).not.toContain('ownBids');expect(json).not.toContain('acceptedBidCount');expect(json).not.toContain('bidder');
    expect(await reconcile(client)).toEqual([]);
  });
});
