import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {makeSignature} from 'better-auth/crypto';
import {execFileSync} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {readLiveWinners} from '../src/modules/admin/live-winners';
import {auctionStatusWhere,readOverviewAuctions,readOverviewSummary} from '../src/modules/admin/workspace-read';
import {submitBid} from '../src/modules/auctions/bids';
import {RULE_V5} from '../src/modules/auctions/rules';
import {ensureWallet,seedPlatformAccounts} from '../src/modules/wallet/ledger';
import {bidAuction} from './bid-fixtures';
import {verifiedReferralUser} from './referral-fixtures';
import {TEST_TOKEN} from './helpers';

it('rejects non-owner staff before reading any accepted bids',async()=>{
 const client={$queryRaw:vi.fn()} as unknown as PrismaClient;
 for(const role of ['FULFILLMENT','AUDITOR','SUPPORT','CATALOG_MANAGER','PAYMENTS_OPERATOR'] as const){
  await expect(readLiveWinners(client,{role},{page:1,q:''})).rejects.toMatchObject({status:403});
 }
 expect(client.$queryRaw).not.toHaveBeenCalled();
});

const database=process.env.LIVE_WINNERS_TEST_DATABASE_URL;
describe.skipIf(!database)('Admin live winner preview on disposable PostgreSQL',()=>{
 const origin='https://lowwin.test',secret='fixture-live-winners-secret-at-least-thirty-two-characters';
 let db:PrismaClient,GET:typeof import('../src/app/api/admin/[...path]/route').GET,ownerCookie:string,playerCookie:string;

 async function session(role:'admin'|'member'){
  const userId=randomUUID(),sessionId=randomUUID(),token=randomUUID(),expiresAt=new Date(Date.now()+3_600_000);
  const telegramId=role==='member'?String(randomInt(9463000000,9464000000)):null;
  await db.user.create({data:{id:userId,name:'Fixture account',email:`fixture-${userId}@lowwin.test`,role,emailVerified:true,telegramId}});
  await db.session.create({data:{id:sessionId,userId,token,expiresAt,telegramLaunchId:telegramId}});
  if(role==='admin'){
   await db.staffMember.create({data:{userId,recoveryHashes:[]}});
   await db.staffSession.create({data:{sessionId,credentialAt:new Date(),expiresAt,authMethod:'email-password'}});
  }
  return '__Secure-better-auth.session_token='+encodeURIComponent(token+'.'+await makeSignature(token,secret));
 }

 beforeAll(async()=>{
  const target=new URL(database!);
  if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback test database required');
  Object.assign(process.env,{APP_ENV:'local',DATABASE_URL:database,DIRECT_URL:database,BETTER_AUTH_URL:origin,MINI_APP_URL:origin,
   BETTER_AUTH_SECRET:secret,TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowwin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',
   PHONE_CONTACT_KEY_ID:'local-fixture',PHONE_CONTACT_KEYS:JSON.stringify({'local-fixture':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});
  ({GET}=await import('../src/app/api/admin/[...path]/route'));
  ownerCookie=await session('admin');
  playerCookie=await session('member');
 },60000);

 afterAll(async()=>{
  if(!db)return;
  await db.$disconnect();
  await (await import('../src/lib/db')).db.$disconnect();
 });

 function request(params:Record<string,string>,cookie=ownerCookie){
  return GET(new Request(origin+'/api/admin/workspace/live-winners?'+new URLSearchParams(params),{headers:{cookie}}),{params:Promise.resolve({path:['workspace','live-winners']})});
 }

 it('requires a signed, password-authorized owner session and serves a private response',async()=>{
  expect((await request({},'')).status).toBe(401);
  expect((await request({},playerCookie)).status).toBe(403);
  const response=await request({q:'no matching auction'});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(await response.json()).toMatchObject({items:[],total:0,page:1,totalPages:0});
 });

 it('shows the lowest unique accepted number only after two distinct eligible participants bid',async()=>{
  const auction=await bidAuction(db,{isDemo:false,ruleVersion:RULE_V5,fee:0});
  const first=await verifiedReferralUser(db,'First bidder'),second=await verifiedReferralUser(db,'Second bidder');
  const bid=(userId:string,amount:string)=>submitBid(db,{userId,auctionSlug:auction.slug!,amount,key:randomUUID(),feeVersion:1});
  const current=async()=>{
   const response=await request({q:String(auction.publicCode)});
   expect(response.status,await response.clone().text()).toBe(200);
   const item=(await response.json()).items.find((row:{auctionId:string})=>row.auctionId===auction.id);
   expect(Object.keys(item).sort()).toEqual(['auctionId','endsAt','leader','publicCode','reason','ruleVersion','title']);
   return item;
  };
  expect(await current()).toMatchObject({leader:null,reason:'NO_BIDS'});
  await bid(first.id,'1.00');
  await bid(first.id,'1.25');
  expect(await current()).toMatchObject({leader:null,reason:'MINIMUM_PARTICIPANTS'});
  await bid(second.id,'1.00');
  expect(await current()).toMatchObject({leader:{bidderName:'First bidder',amount:'1.25'},reason:null});
  await bid(second.id,'1.25');
  expect(await current()).toMatchObject({leader:null,reason:'NO_UNIQUE_BID'});
  await bid(second.id,'1.09');
  const readOnlyState=await Promise.all([db.auctionSettlement.count(),db.outbox.count(),db.adminAudit.count()]);
  expect((await current()).leader).toEqual({bidderName:'Second bidder',amount:'1.09'});
  expect(await Promise.all([db.auctionSettlement.count(),db.outbox.count(),db.adminAudit.count()])).toEqual(readOnlyState);
 });

 it('excludes demo, upcoming and expired auctions and retains pagination metadata on an empty page',async()=>{
  const title='Live winner fixture '+randomUUID();
  const [live,demo,upcoming,expired]=await Promise.all([
   bidAuction(db,{isDemo:false,ruleVersion:RULE_V5}),
   bidAuction(db,{isDemo:true,ruleVersion:RULE_V5}),
   bidAuction(db,{isDemo:false,ruleVersion:RULE_V5,startOffsetMs:120000}),
   bidAuction(db,{isDemo:false,ruleVersion:RULE_V5,endDelayMs:-1000}),
  ]);
  await db.product.updateMany({where:{id:{in:[live,demo,upcoming,expired].map(auction=>auction.productId!)}},data:{title}});
  const page=await (await request({q:title})).json();
  expect(page).toMatchObject({items:[{auctionId:live.id}],total:1,page:1,totalPages:1});
  expect(await (await request({q:title,page:'2'})).json()).toMatchObject({items:[],total:1,page:2,totalPages:1});
 });

 it('keeps the live Overview count and auction row status in a non-UTC database session',async()=>{
  await bidAuction(db,{ruleVersion:RULE_V5,isDemo:false,endDelayMs:600000});
  await db.$transaction(async tx=>{
   // Anchor to a row guaranteed to be in the bounded Overview list, even
   // when rerunning with other auction fixtures still in the database.
   const auction=await tx.auction.findFirstOrThrow({
    where:{...auctionStatusWhere('IN_PROGRESS',new Date()),startsAt:{not:null},endsAt:{not:null}},
    orderBy:[{endsAt:'asc'},{id:'asc'}],select:{id:true,startsAt:true,endsAt:true},
   });
   const now=new Date(Math.max(auction.startsAt!.getTime(),auction.endsAt!.getTime()-600000));
   const actor={id:'owner',role:'OWNER' as const,now},client=tx as unknown as PrismaClient;
   await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
   const control=await readOverviewSummary(client,actor);
   expect(control.auctions).toMatchObject({state:'ready',count:expect.any(Number)});
   if(control.auctions?.state==='ready')expect(control.auctions.count).toBeGreaterThan(0);
   await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Nairobi'`;
   const summary=await readOverviewSummary(client,actor),rows=await readOverviewAuctions(client,actor);
   expect(summary.auctions).toEqual(control.auctions);
   expect(rows.items.find(row=>row.id===auction.id)?.displayStatus).toBe('LIVE');
  });
 });

 it('counts journal-linked payments and new members only for the clipped Addis day and staff permissions',async()=>{
  vi.stubEnv('CHAPA_SCHEMA_READY','true');
  const auction=await bidAuction(db,{ruleVersion:RULE_V5,isDemo:false});
  const midnight=new Date('2026-03-29T21:00:00.000Z'),now=new Date('2026-03-30T17:00:00.000Z');
  const before=new Date(midnight.getTime()-1),future=new Date(now.getTime()+1);
  const rollback=Error('Discard synthetic daily Overview receipts');
  try{
   await db.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
    const createPlayer=(createdAt:Date)=>tx.user.create({data:{id:randomUUID(),name:'Daily fixture',telegramId:String(randomInt(9240000000,9241000000)),createdAt}});
    const player=await createPlayer(midnight);
    await createPlayer(before);
    await createPlayer(future);
    await ensureWallet(tx,player.id);
    await seedPlatformAccounts(tx);
    const [issuance,available]=await Promise.all(['platform:issuance',`user:${player.id}:available`].map(name=>tx.ledgerAccount.findUniqueOrThrow({where:{name}})));
    const hash='f'.repeat(64);
    async function journal({scope,key,reference,result,postedAt,cents}:{scope:string;key:string;reference:string;result:Prisma.InputJsonObject;postedAt:Date;cents:bigint}){
     const operation=await tx.operation.create({data:{userId:player.id,scope,key,requestHash:hash,result,createdAt:postedAt}});
     const amount=new Prisma.Decimal(cents.toString()).div(100);
     return tx.journal.create({data:{operationId:operation.id,kind:scope,reference,createdAt:postedAt,postings:{create:[
      {accountId:issuance.id,delta:amount.negated()},{accountId:available.id,delta:amount},
     ]}}});
    }
    async function chapa(cents:bigint,postedAt:Date,{mode='live',purpose='TOP_UP',failed=false}:{mode?:'live'|'test';purpose?:'TOP_UP'|'BID';failed?:boolean}={}){
     const id=randomUUID(),merchantReference=id.replaceAll('-','').slice(0,20),chapaReference='CH'+id.replaceAll('-','');
     const result={checkoutId:id,merchantReference,chapaReference,mode,currency:'ETB',amountCents:cents.toString()};
     const credit=failed?null:await journal({scope:'CHAPA_RECEIPT',key:id,reference:'chapa:'+merchantReference,result,postedAt,cents});
     await tx.chapaCheckout.create({data:{id,userId:player.id,purpose,mode,credentialFingerprint:hash,key:id,requestHash:hash,
      initialization:{},merchantReference,chapaReference,amountCents:cents,providerStatus:failed?'FAILED':'SUCCESS',verificationState:'VERIFIED',
      status:failed?'FAILED':purpose==='BID'?'NEEDS_REVIEW':'CREDITED',creditJournalId:credit?.id,evidenceHash:credit?hash:null,
      createdAt:new Date(before.getTime()-60000),expiresAt:new Date(future.getTime()+60000),
      ...(purpose==='BID'?{auctionId:auction.id,auctionSlug:auction.slug,bidNumber:'5',grossFee:new Prisma.Decimal(cents.toString()).div(100),feeVersion:1}:{})}});
    }
    await chapa(10034n,midnight);
    await chapa(888n,now);
    await chapa(3458n,now,{purpose:'BID'});
    await chapa(20000n,before);
    await chapa(30000n,future);
    await chapa(40000n,now,{mode:'test'});
    await chapa(50000n,now,{failed:true});

    const id=randomUUID(),postedAt=new Date('2026-03-30T12:00:00Z'),amountCents=2173n;
    const credit=await journal({scope:'TOPUP_CREDIT',key:id,reference:id,result:{},postedAt,cents:amountCents});
    await tx.topUpIntent.create({data:{id,userId:player.id,key:id,provider:'VERIFY_ET',channel:'telebirr',reference:id,status:'CREDITED',
     points:'21.73',policyVersion:'fixture',expectedCents:amountCents,journalId:credit.id,createdAt:postedAt}});
    await tx.paymentClaim.create({data:{channel:'telebirr',reference:id,intentId:id,userId:player.id,amountCents,points:'21.73',receiverSuffix:'001',transferredAt:postedAt,
     operationId:credit.operationId,journalId:credit.id,evidenceHash:hash,createdAt:postedAt}});
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;

    const client=tx as unknown as PrismaClient;
    const owner=await readOverviewSummary(client,{id:'owner',role:'OWNER',now});
    expect(owner.daily).toEqual({newMembers:{state:'ready',count:1},money:{state:'ready',depositEtb:'130.95',successfulPayments:4,paymentEtb:'165.53'}});
    const support=await readOverviewSummary(client,{id:'support',role:'SUPPORT',now});
    expect(support.daily).toEqual({newMembers:{state:'ready',count:1}});
    throw rollback;
   });
  }catch(error){
   if(error!==rollback)throw error;
  }finally{vi.unstubAllEnvs()}
 });
});
