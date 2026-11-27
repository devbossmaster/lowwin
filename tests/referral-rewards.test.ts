import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {execFileSync} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {contactBotId} from '../src/modules/auth/own-contact';
import {attributeNewReferralInTransaction,getReferralOverview,getReferralPolicy,recordBotReferralStart,referralPolicySchema,settlePendingReferralWalletRewards} from '../src/modules/referrals/service';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {verifyFixtureContact} from './contact-fixtures';
import {signedLaunch} from './helpers';
import {guardedReferralFixture,realReferralAuction,referredRegistration,verifiedReferralUser} from './referral-fixtures';
import {bidAuction} from './bid-fixtures';

const url=process.env.REFERRAL_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('referral rewards on isolated PostgreSQL',()=>{
 let db:PrismaClient,sponsor:Awaited<ReturnType<typeof verifiedReferralUser>>,other:typeof sponsor,registered:Awaited<ReturnType<typeof referredRegistration>>;
 const balance=async(userId:string)=>(await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}})).balance.toString();
 beforeAll(async()=>{
  guardedReferralFixture();
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();await db.referralPolicy.create({data:{enabled:true,rewardCents:1250n,updatedBy:'local-fixture-owner'}});
  sponsor=await verifiedReferralUser(db);other=await verifiedReferralUser(db);await creditDevelopmentPoints(db,sponsor.id,'100',`referral-fixture-${randomUUID()}`);await creditDevelopmentPoints(db,other.id,'100',`referral-fixture-${randomUUID()}`);
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 it('validates the configured range and leaves disabled old schemas untouched',async()=>{
  for(const rewardEtb of ['0','-1','1.001','NaN','100001','1e3',5])expect(referralPolicySchema.safeParse({enabled:true,rewardEtb}).success).toBe(false);
  expect((await getReferralPolicy(db,{REFERRAL_REWARDS_SCHEMA_READY:'false'})).configured).toBe(false);expect(await getReferralOverview(db,sponsor.id,{REFERRAL_REWARDS_SCHEMA_READY:'false'})).toMatchObject({configured:false,shareUrl:null,totalEarnedEtb:'0.00',recentInvites:[]});
 });
 it('binds a trusted first bot start to contact registration and never retroclaims a customer',async()=>{
  registered=await referredRegistration(db,sponsor.id);const signup=await db.referralSignup.findUniqueOrThrow({where:{referredUserId:registered.id}});expect(signup.referrerUserId).toBe(sponsor.id);expect(signup.firstBidId).toBeNull();
  const pending=await db.referralPendingSignup.findUniqueOrThrow({where:{botId_telegramId:{botId:contactBotId(),telegramId:String(registered.telegramId)}}});expect(pending.consumedUserId).toBe(registered.id);expect(pending.expiresAt.getTime()-pending.createdAt.getTime()).toBe(30*86400000);
  expect(await recordBotReferralStart(db,String(other.telegramId),contactBotId(),registered.payload)).toBe(false);expect(await db.referralSignup.findUnique({where:{referredUserId:other.id}})).toBeNull();
  expect(await getReferralOverview(db,sponsor.id)).toMatchObject({counts:{signedUp:1,qualified:0,earned:0},recentInvites:[{registeredAt:signup.registeredAt.toISOString(),firstBidAccepted:false}]});
 });
 it('credits once after the first accepted bid and leaves failed or later bids without rewards',async()=>{
  const auction=await realReferralAuction(db,10),key=randomUUID(),before=await balance(sponsor.id);
  const input={userId:registered.id,auctionSlug:auction.slug!,amount:'7',feeVersion:1,key};
  await expect(submitBid(db,input)).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});
  expect(await db.referralWalletReward.count()).toBe(0);
  await creditDevelopmentPoints(db,registered.id,'100',randomUUID());
  const first=await submitBid(db,input);
  expect(await submitBid(db,input)).toEqual(first);
  await submitBid(db,{...input,amount:'9',key:randomUUID()});
  const reward=await db.referralWalletReward.findUniqueOrThrow({where:{referredUserId:registered.id}});
  expect(reward).toMatchObject({referrerUserId:sponsor.id,bidId:first.bid.id,amountCents:1250n,creditedAt:expect.any(Date)});
  expect(await balance(sponsor.id)).toBe(String(Number(before)+12.5));
  expect(await db.referralCoupon.count()).toBe(0);
  const overview=await getReferralOverview(db,sponsor.id);
  expect(overview).toMatchObject({rewardEtb:'12.50',counts:{signedUp:1,qualified:1,earned:1},totalEarnedEtb:'12.50'});
  const signup=await db.referralSignup.findUniqueOrThrow({where:{referredUserId:registered.id}});
  expect(overview.recentInvites).toEqual([{registeredAt:signup.registeredAt.toISOString(),firstBidAccepted:true}]);
  expect(await reconcile(db)).toEqual([]);
 });
 it('serializes concurrent first bids in different auctions and emits one wallet credit',async()=>{
  const referred=await referredRegistration(db,sponsor.id);
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  const auctions=[await realReferralAuction(db,10),await realReferralAuction(db,10)];
  const receipts=await Promise.all(auctions.map(auction=>submitBid(db,{userId:referred.id,auctionSlug:auction.slug!,amount:'7',feeVersion:1,key:randomUUID()})));
  const reward=await db.referralWalletReward.findUniqueOrThrow({where:{referredUserId:referred.id}});
  expect(receipts.map(receipt=>receipt.bid.id)).toContain(reward.bidId);
  expect(await db.operation.count({where:{scope:'REFERRAL_REWARD',key:referred.id}})).toBe(1);
 });
 it('ignores a demo bid and still credits the next first genuine accepted bid',async()=>{
  const referred=await referredRegistration(db,sponsor.id);
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  const demo=await bidAuction(db,{isDemo:true}),real=await realReferralAuction(db,10);
  const input={userId:referred.id,auctionSlug:demo.slug!,feeVersion:1,key:randomUUID(),amount:'7'};
  await submitBid(db,input);
  expect(await db.referralSignup.findUnique({where:{referredUserId:referred.id}})).toMatchObject({firstBidId:null});
  const firstReal=await submitBid(db,{...input,auctionSlug:real.slug!,key:randomUUID()});
  expect(await db.referralWalletReward.findUnique({where:{referredUserId:referred.id}})).toMatchObject({bidId:firstReal.bid.id,creditedAt:expect.any(Date)});
 });
 it('uses the current settings on qualification and never retroactively credits a first bid that arrived while paused',async()=>{
  const referred=await referredRegistration(db,sponsor.id);
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  const auction=await realReferralAuction(db,10);
  const input={userId:referred.id,auctionSlug:auction.slug!,feeVersion:1,key:randomUUID(),amount:'7'};
  await db.referralPolicy.update({where:{id:'default'},data:{enabled:false,version:{increment:1}}});
  await submitBid(db,input);
  expect((await getReferralOverview(db,sponsor.id)).shareUrl).toBeNull();
  await db.referralPolicy.update({where:{id:'default'},data:{enabled:true,rewardCents:2301n,version:{increment:1}}});
  await submitBid(db,{...input,key:randomUUID(),amount:'8'});
  expect(await db.referralWalletReward.findUnique({where:{referredUserId:referred.id}})).toBeNull();
  const next=await referredRegistration(db,sponsor.id);
  await creditDevelopmentPoints(db,next.id,'100',randomUUID());
  await submitBid(db,{...input,userId:next.id,key:randomUUID()});
  expect(await db.referralWalletReward.findUnique({where:{referredUserId:next.id}})).toMatchObject({amountCents:2301n});
  const original=await db.referralWalletReward.findUniqueOrThrow({where:{referredUserId:registered.id}});
  expect(original.amountCents).toBe(1250n);
  await expect(db.referralWalletReward.update({where:{referredUserId:registered.id},data:{amountCents:15n}})).rejects.toThrow();
 });
 it('keeps an accepted bid when the sponsor wallet is busy and credits the recorded amount once after release',async()=>{
  const referred=await referredRegistration(db,sponsor.id),auction=await realReferralAuction(db,10),before=Number(await balance(sponsor.id));
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  let release!:()=>void,locked!:()=>void;
  const waiting=new Promise<void>(resolve=>{locked=resolve}),held=new Promise<void>(resolve=>{release=resolve});
  const lockTx=db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'wallet:'+sponsor.id},0))`;
   locked();
   await held;
  });
  await waiting;
  try{
   const receipt=await submitBid(db,{userId:referred.id,auctionSlug:auction.slug!,feeVersion:1,key:randomUUID(),amount:'11'});
   expect(await db.referralWalletReward.findUnique({where:{referredUserId:referred.id}})).toMatchObject({bidId:receipt.bid.id,creditedAt:null});
   expect(Number(await balance(sponsor.id))).toBe(before);
   expect(await settlePendingReferralWalletRewards(db)).toBe(false);
  }finally{release();await lockTx}
  await db.referralPolicy.update({where:{id:'default'},data:{enabled:false}});
  try{
   expect((await Promise.all([settlePendingReferralWalletRewards(db),settlePendingReferralWalletRewards(db)])).filter(Boolean)).toHaveLength(1);
   expect(Number(await balance(sponsor.id))).toBeCloseTo(before+23.01,2);
   expect(await db.operation.count({where:{scope:'REFERRAL_REWARD',key:referred.id}})).toBe(1);
  }finally{await db.referralPolicy.update({where:{id:'default'},data:{enabled:true}})}
 });
 it('maintains same-transaction proof for a bid created inside the payment savepoint',async()=>{
  const referred=await referredRegistration(db,sponsor.id),auction=await realReferralAuction(db,10);
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  const receipt=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SAVEPOINT referral_payment_fixture');
   const bid=await submitBidInTransaction(tx,{userId:referred.id,auctionSlug:auction.slug!,feeVersion:1,key:randomUUID(),amount:'13'});
   await tx.$executeRawUnsafe('RELEASE SAVEPOINT referral_payment_fixture');
   return bid;
  });
  expect(await db.referralWalletReward.findUnique({where:{referredUserId:referred.id}})).toMatchObject({bidId:receipt.bid.id,creditedAt:expect.any(Date)});
 });
 it('rejects a standalone balanced wallet credit without its accepted referral proof',async()=>{
  const before=await balance(sponsor.id),key=randomUUID();
  const available=await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${sponsor.id}:available`}}),funding=await db.ledgerAccount.findUniqueOrThrow({where:{name:'platform:referral-wallet-rewards'}});
  await expect(db.$transaction(async tx=>{
   const op=await tx.operation.create({data:{userId:sponsor.id,scope:'REFERRAL_REWARD',key,requestHash:'fixture',result:{}}});
   await tx.journal.create({data:{operationId:op.id,kind:'REFERRAL_REWARD',reference:'fixture',postings:{create:[{accountId:funding.id,delta:-1},{accountId:available.id,delta:1}]}}});
  })).rejects.toThrow();
  expect(await balance(sponsor.id)).toBe(before);
  expect(await db.operation.count({where:{scope:'REFERRAL_REWARD',key}})).toBe(0);
  expect(await reconcile(db)).toEqual([]);
 });
 it('uses signed first-launch attribution only and ignores existing/unsigned/tampered sources',async()=>{
  const {handleAuth}=await import('../src/modules/auth/handler'),overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!,origin=process.env.BETTER_AUTH_URL!,make=(telegramId:number,fields:Record<string,string>={})=>new Request(origin+'/api/auth/telegram/miniapp/signin?ref='+payload,{method:'POST',headers:{origin:new URL(origin).origin,'content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Signed referral fixture'}),...fields},process.env.TELEGRAM_BOT_TOKEN)})});
  const tid=randomInt(8000000000,8900000000),signed=await handleAuth(make(tid,{start_param:payload}));expect(await signed.json()).toMatchObject({status:'contact-required'});expect(await db.user.findUnique({where:{telegramId:String(tid)}})).toBeNull();
  await verifyFixtureContact(db,tid);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(tid)}});expect((await db.referralSignup.findUniqueOrThrow({where:{referredUserId:user.id}})).referrerUserId).toBe(sponsor.id);
  expect((await handleAuth(make(other.telegramId,{start_param:payload}))).status).toBe(200);expect(await db.referralSignup.findUnique({where:{referredUserId:other.id}})).toBeNull();
  const unsignedId=randomInt(8000000000,8900000000);expect(await (await handleAuth(make(unsignedId))).json()).toMatchObject({status:'contact-required'});await verifyFixtureContact(db,unsignedId);const unsigned=await db.user.findUniqueOrThrow({where:{telegramId:String(unsignedId)}});expect(await db.referralSignup.findUnique({where:{referredUserId:unsigned.id}})).toBeNull();
  const changed=new Request(origin+'/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:new URL(origin).origin,'content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:randomInt(8000000000,8900000000),first_name:'Tampered referral'})},process.env.TELEGRAM_BOT_TOKEN)+'&start_param='+payload})});expect((await handleAuth(changed)).status).toBe(401);
 });
 it('ignores expired pre-registration attribution and restricted referrers',async()=>{
  const telegramId=randomInt(8000000000,8900000000),old=new Date(Date.now()-31*86400000);await db.referralPendingSignup.create({data:{botId:contactBotId(),telegramId:String(telegramId),referrerUserId:sponsor.id,createdAt:old,expiresAt:new Date(old.getTime()+30*86400000)}});await verifyFixtureContact(db,telegramId);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});expect(await db.referralSignup.findUnique({where:{referredUserId:user.id}})).toBeNull();
  const overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!;await db.userRestriction.create({data:{userId:sponsor.id,suspended:true,reason:'Isolated referral restriction'}});expect(await recordBotReferralStart(db,String(randomInt(8000000000,8900000000)),contactBotId(),payload)).toBe(false);await db.userRestriction.update({where:{userId:sponsor.id},data:{suspended:false}});
 });
 it('renews an expired unused bot start without retroclaiming a registered account',async()=>{
  const telegramId=randomInt(8000000000,8900000000),old=new Date(Date.now()-31*86400000),overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!;
  const pending=await db.referralPendingSignup.create({data:{botId:contactBotId(),telegramId:String(telegramId),referrerUserId:sponsor.id,createdAt:old,expiresAt:new Date(old.getTime()+30*86400000)}});expect(await recordBotReferralStart(db,String(telegramId),contactBotId(),payload)).toBe(true);
  const renewed=await db.referralPendingSignup.findUniqueOrThrow({where:{id:pending.id}});expect(renewed.createdAt).toEqual(old);expect(renewed.renewedAt).not.toBeNull();expect(renewed.expiresAt.getTime()-renewed.renewedAt!.getTime()).toBe(30*86400000);
  await verifyFixtureContact(db,telegramId);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});expect((await db.referralSignup.findUniqueOrThrow({where:{referredUserId:user.id}})).referrerUserId).toBe(sponsor.id);expect(await recordBotReferralStart(db,String(telegramId),contactBotId(),payload)).toBe(false);
 });
 it('uses transaction registration proof across positive and negative app-clock skew',async()=>{
  const overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!;
  for(const skew of [-2000,2000])await db.$transaction(async tx=>{const tid=String(randomInt(8000000000,8900000000)),user=await tx.user.create({data:{id:randomUUID(),name:'Clock-skew fixture',telegramId:tid,createdAt:new Date(Date.now()+skew)}});await attributeNewReferralInTransaction(tx,user.id,tid,{newAccount:true,signedStartParam:payload});expect((await tx.referralSignup.findUniqueOrThrow({where:{referredUserId:user.id}})).referrerUserId).toBe(sponsor.id)});
  await expect(db.$transaction(tx=>attributeNewReferralInTransaction(tx,other.id,String(other.telegramId),{newAccount:true,signedStartParam:payload}))).rejects.toThrow();expect(await db.referralSignup.findUnique({where:{referredUserId:other.id}})).toBeNull();
 });
 it('supports the restricted runtime role and keeps proof and immutable tables protected',async()=>{
  const admin=new Client({connectionString:url});await admin.connect();try{await admin.query(readFileSync('deploy/runtime-role.sql','utf8'))}finally{await admin.end()}
  await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');const tid=String(randomInt(8000000000,8900000000)),user=await tx.user.create({data:{id:randomUUID(),name:'Restricted runtime fixture',telegramId:tid}});expect(await tx.referralRegistrationProof.findUnique({where:{userId:user.id}})).not.toBeNull();expect(await tx.referralPolicy.findUnique({where:{id:'default'}})).not.toBeNull();expect(await tx.referralWalletReward.count()).toBeGreaterThan(0)});
  const referred=await referredRegistration(db,sponsor.id),auction=await realReferralAuction(db,10);
  await creditDevelopmentPoints(db,referred.id,'100',randomUUID());
  const accepted=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');
   return submitBidInTransaction(tx,{userId:referred.id,auctionSlug:auction.slug!,feeVersion:1,key:randomUUID(),amount:'8'});
  });
  expect(await db.referralWalletReward.findUnique({where:{referredUserId:referred.id}})).toMatchObject({bidId:accepted.bid.id,creditedAt:expect.any(Date)});
  await expect(db.referralRegistrationProof.create({data:{userId:other.id}})).rejects.toThrow();
  const permissions=await db.$queryRaw<Array<{table_name:string;delete_allowed:boolean}>>`SELECT t AS table_name,has_table_privilege('lowwin_runtime',format('%I',t),'DELETE') AS delete_allowed FROM unnest(ARRAY['ReferralPolicy','ReferralInvite','ReferralPendingSignup','ReferralSignup','ReferralCoupon','ReferralRedemption','ReferralRegistrationProof','ReferralWalletReward']) t`;
  expect(permissions.every(row=>!row.delete_allowed)).toBe(true);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps the first trusted invitation during duplicate starts and later competing invitations',async()=>{
  const first=await getReferralOverview(db,sponsor.id),second=await getReferralOverview(db,other.id),payload=new URL(first.shareUrl!).searchParams.get('start')!,otherPayload=new URL(second.shareUrl!).searchParams.get('start')!,tid=String(randomInt(8000000000,8900000000));
  const starts=await Promise.all([recordBotReferralStart(db,tid,contactBotId(),payload),recordBotReferralStart(db,tid,contactBotId(),payload)]);expect(starts.filter(Boolean)).toHaveLength(1);
  expect(await recordBotReferralStart(db,tid,contactBotId(),otherPayload)).toBe(false);expect(await db.referralPendingSignup.count({where:{botId:contactBotId(),telegramId:tid}})).toBe(1);
  await verifyFixtureContact(db,Number(tid));const user=await db.user.findUniqueOrThrow({where:{telegramId:tid}});expect(await db.referralSignup.findUnique({where:{referredUserId:user.id}})).toMatchObject({referrerUserId:sponsor.id,firstBidId:null});expect(await db.referralCoupon.count({where:{referredUserId:user.id}})).toBe(0);
 });
 it('rejects wrong-bot and malformed invitation starts without creating attribution',async()=>{
  const overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!,tid=String(randomInt(8000000000,8900000000));
  expect(await recordBotReferralStart(db,tid,'999999999',payload)).toBe(false);expect(await recordBotReferralStart(db,tid,contactBotId(),payload+'tampered')).toBe(false);expect(await db.referralPendingSignup.count({where:{telegramId:tid}})).toBe(0);
 });
 it('returns a complete valid invitation URL and no link for an invalid bot configuration',async()=>{
  const overview=await getReferralOverview(db,sponsor.id),url=new URL(overview.shareUrl!);expect(url.origin).toBe('https://t.me');expect(url.pathname).toBe('/'+process.env.TELEGRAM_BOT_USERNAME);expect(url.searchParams.get('start')).toMatch(/^ref_[A-Za-z0-9_-]{12}$/);
  expect((await getReferralOverview(db,sponsor.id,{...process.env,TELEGRAM_BOT_USERNAME:'wrong/bot'})).shareUrl).toBeNull();
 });
 it('returns only the latest ten invites owned by the referrer without identifying details',async()=>{
  const owner=await verifiedReferralUser(db);
  const customers=Array.from({length:13},(_,index)=>({
   id:randomUUID(),name:'Private referral fixture',telegramId:String(randomInt(8000000000,8900000000)),
   registeredAt:new Date(Date.UTC(2026,10,5,15,20,index,321)),
  }));
  await db.$transaction(async tx=>{
   await tx.user.createMany({data:customers.map(({id,name,telegramId})=>({id,name,telegramId}))});
   await tx.referralSignup.createMany({data:customers.map(({id,registeredAt},index)=>({
    referredUserId:id,registeredAt,referrerUserId:index===12?other.id:owner.id,
   }))});
  });
  const overview=await getReferralOverview(db,owner.id);
  expect(overview.counts.signedUp).toBe(12);
  expect(overview.recentInvites).toEqual(customers.slice(2,12).reverse().map(({registeredAt})=>({registeredAt:registeredAt.toISOString(),firstBidAccepted:false})));
 });
});
