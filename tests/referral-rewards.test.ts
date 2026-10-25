import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {execFileSync} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {contactBotId} from '../src/modules/auth/own-contact';
import {attributeNewReferralInTransaction,getBidDiscountQuote,getReferralOverview,getReferralPolicy,recordBotReferralStart,referralPolicySchema} from '../src/modules/referrals/service';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {verifyFixtureContact} from './contact-fixtures';
import {signedLaunch} from './helpers';
import {earnedReferralCoupon,guardedReferralFixture,realReferralAuction,referredRegistration,verifiedReferralUser} from './referral-fixtures';

const url=process.env.REFERRAL_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('referral rewards on isolated PostgreSQL',()=>{
 let db:PrismaClient,sponsor:Awaited<ReturnType<typeof verifiedReferralUser>>,other:typeof sponsor,registered:Awaited<ReturnType<typeof referredRegistration>>,firstCouponId:string;
 const balance=async(userId:string)=>(await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${userId}:available`}})).balance.toString();
 beforeAll(async()=>{
  guardedReferralFixture();
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'local-fixture-owner'}});
  sponsor=await verifiedReferralUser(db);other=await verifiedReferralUser(db);await creditDevelopmentPoints(db,sponsor.id,'100',`referral-fixture-${randomUUID()}`);await creditDevelopmentPoints(db,other.id,'100',`referral-fixture-${randomUUID()}`);
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 it('validates the configured range and leaves disabled old schemas untouched',async()=>{
  for(const [discountPercent,expiryDays] of [[4,30],[16,30],[10,14],[10,31],[5.5,20]])expect(referralPolicySchema.safeParse({enabled:true,discountPercent,expiryDays}).success).toBe(false);
  expect((await getReferralPolicy(db,{REFERRAL_REWARDS_SCHEMA_READY:'false'})).configured).toBe(false);expect(await getReferralOverview(db,sponsor.id,{REFERRAL_REWARDS_SCHEMA_READY:'false'})).toMatchObject({configured:false,shareUrl:null,coupons:[]});
  await expect(getBidDiscountQuote(db,sponsor.id,'unused',undefined,{REFERRAL_REWARDS_SCHEMA_READY:'false'})).rejects.toMatchObject({status:503});
 });
 it('binds a trusted first bot start to contact registration and never retroclaims a customer',async()=>{
  registered=await referredRegistration(db,sponsor.id);const signup=await db.referralSignup.findUniqueOrThrow({where:{referredUserId:registered.id}});expect(signup.referrerUserId).toBe(sponsor.id);expect(signup.firstBidId).toBeNull();
  const pending=await db.referralPendingSignup.findUniqueOrThrow({where:{botId_telegramId:{botId:contactBotId(),telegramId:String(registered.telegramId)}}});expect(pending.consumedUserId).toBe(registered.id);expect(pending.expiresAt.getTime()-pending.createdAt.getTime()).toBe(30*86400000);
  expect(await recordBotReferralStart(db,String(other.telegramId),contactBotId(),registered.payload)).toBe(false);expect(await db.referralSignup.findUnique({where:{referredUserId:other.id}})).toBeNull();
  expect((await getReferralOverview(db,sponsor.id)).counts).toEqual({signedUp:1,qualified:0,earned:0,available:0});
 });
 it('awards nothing for a failed attempt, then exactly once for the first accepted bid and replay',async()=>{
  const auction=await realReferralAuction(db,10),key=randomUUID(),input={userId:registered.id,auctionSlug:auction.slug!,amount:'7',feeVersion:1,key};await expect(submitBid(db,input)).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});expect(await db.referralCoupon.count()).toBe(0);
  await creditDevelopmentPoints(db,registered.id,'100',`referral-fixture-${randomUUID()}`);const first=await submitBid(db,input);expect(await submitBid(db,input)).toEqual(first);await submitBid(db,{...input,amount:'9',key:randomUUID()});
  const coupon=await db.referralCoupon.findUniqueOrThrow({where:{referredUserId:registered.id}});firstCouponId=coupon.id;expect(coupon.ownerUserId).toBe(sponsor.id);expect(coupon.percent).toBe(10);expect(coupon.expiresAt.getTime()-coupon.createdAt.getTime()).toBe(30*86400000);expect(await db.referralCoupon.count()).toBe(1);expect(first.hold.extraReserved).toBe('0');
  expect((await getReferralOverview(db,sponsor.id)).counts).toEqual({signedUp:1,qualified:1,earned:1,available:1});expect(await reconcile(db)).toEqual([]);
 });
 it('quotes owned rewards without consuming them, and rejects another account',async()=>{
  const auction=await realReferralAuction(db,20),before=await balance(sponsor.id),quote=await getBidDiscountQuote(db,sponsor.id,auction.slug!);expect(quote).toMatchObject({grossFeePoints:'20',discountPoints:'2',netFeePoints:'18',feeVersion:1,coupon:{id:firstCouponId,percent:10}});expect(await balance(sponsor.id)).toBe(before);expect(await db.referralRedemption.count()).toBe(0);
  await expect(getBidDiscountQuote(db,other.id,auction.slug!,firstCouponId)).rejects.toMatchObject({status:409});
 });
 it('redeems atomically as contra-fees while keeping frozen gross fee and idempotency',async()=>{
  const auction=await realReferralAuction(db,20),before=await balance(sponsor.id),feesBefore=(await db.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}})).balance,key=randomUUID(),input={userId:sponsor.id,auctionSlug:auction.slug!,amount:'12',feeVersion:1,key,couponId:firstCouponId};
  const receipt=await submitBid(db,input);expect(receipt.charge).toMatchObject({feePoints:'20',discountPoints:'2',netFeePoints:'18',newlyUnavailable:'18',couponId:firstCouponId});expect(receipt.bid.feePoints).toBe('20');expect(await balance(sponsor.id)).toBe(String(Number(before)-18));expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}})).balance.sub(feesBefore).toString()).toBe('18');
  expect(await submitBid(db,input)).toEqual(receipt);expect(await db.referralRedemption.count({where:{couponId:firstCouponId}})).toBe(1);expect(await db.journal.count({where:{kind:'REFERRAL_DISCOUNT'}})).toBe(1);await expect(submitBid(db,{...input,couponId:randomUUID()})).rejects.toMatchObject({code:'KEY_REUSED'});expect(await reconcile(db)).toEqual([]);
 });
 it('allows only one of two concurrent submissions to spend the same reward',async()=>{
  const {coupon}=await earnedReferralCoupon(db,sponsor.id),a=await realReferralAuction(db,10),b=await realReferralAuction(db,10),before=Number(await balance(sponsor.id));
  const attempts=await Promise.allSettled([a,b].map(auction=>submitBid(db,{userId:sponsor.id,auctionSlug:auction.slug!,amount:'21',feeVersion:1,key:randomUUID(),couponId:coupon.id})));
  expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(await db.referralRedemption.count({where:{couponId:coupon.id}})).toBe(1);expect(Number(await balance(sponsor.id))).toBe(before-9);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps earned snapshots when policy changes or pauses, and snapshots the next grant',async()=>{
  const {coupon}=await earnedReferralCoupon(db,sponsor.id);await db.referralPolicy.update({where:{id:'default'},data:{discountPercent:15,expiryDays:15,version:{increment:1}}});expect((await db.referralCoupon.findUniqueOrThrow({where:{id:coupon.id}})).percent).toBe(10);
  const newer=await earnedReferralCoupon(db,sponsor.id);expect(newer.coupon.percent).toBe(15);expect(newer.coupon.expiresAt.getTime()-newer.coupon.createdAt.getTime()).toBe(15*86400000);
  await db.referralPolicy.update({where:{id:'default'},data:{enabled:false,version:{increment:1}}});const auction=await realReferralAuction(db,10);expect((await getBidDiscountQuote(db,sponsor.id,auction.slug!,coupon.id)).discountPoints).toBe('1');expect((await getReferralOverview(db,sponsor.id)).shareUrl).toBeNull();await expect(db.referralCoupon.update({where:{id:coupon.id},data:{percent:15}})).rejects.toThrow();await db.referralPolicy.update({where:{id:'default'},data:{enabled:true,discountPercent:10,expiryDays:30,version:{increment:1}}});
 });
 it('rolls back a rejected deadline bid without consuming or crediting a reward',async()=>{
  const {coupon}=await earnedReferralCoupon(db,sponsor.id),auction=await realReferralAuction(db,20,600);await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+20)));const before=await balance(sponsor.id);
  await expect(submitBid(db,{userId:sponsor.id,auctionSlug:auction.slug!,amount:'31',feeVersion:1,key:randomUUID(),couponId:coupon.id})).rejects.toMatchObject({code:'AUCTION_CLOSED'});expect(await db.referralRedemption.findUnique({where:{couponId:coupon.id}})).toBeNull();expect(await balance(sponsor.id)).toBe(before);expect(await reconcile(db)).toEqual([]);
 });
 it('rejects a standalone balanced reward credit and a forged redemption at commit',async()=>{
  const before=await balance(sponsor.id),key=randomUUID(),available=await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${sponsor.id}:available`}}),fees=await db.ledgerAccount.findUniqueOrThrow({where:{name:'platform:fees'}});
  await expect(db.$transaction(async tx=>{const op=await tx.operation.create({data:{userId:sponsor.id,scope:'REFERRAL_DISCOUNT',key,requestHash:'forged',result:{}}});await tx.journal.create({data:{operationId:op.id,kind:'REFERRAL_DISCOUNT',reference:'forged',postings:{create:[{accountId:fees.id,delta:-1},{accountId:available.id,delta:1}]}}})})).rejects.toThrow();expect(await balance(sponsor.id)).toBe(before);expect(await db.operation.findUnique({where:{userId_scope_key:{userId:sponsor.id,scope:'REFERRAL_DISCOUNT',key}}})).toBeNull();
  const {coupon}=await earnedReferralCoupon(db,sponsor.id),auction=await realReferralAuction(db,10),count=await db.bid.count({where:{userId:sponsor.id}});
  await expect(db.$transaction(async tx=>{const bid=await submitBidInTransaction(tx,{userId:sponsor.id,auctionSlug:auction.slug!,amount:'44',feeVersion:1,key:randomUUID()}),op=await tx.operation.create({data:{userId:sponsor.id,scope:'REFERRAL_DISCOUNT',key:bid.bid.id,requestHash:'forged',result:{bidId:bid.bid.id,couponId:coupon.id,discountPoints:'3'}}});await tx.journal.create({data:{operationId:op.id,kind:'REFERRAL_DISCOUNT',reference:`bid:${bid.bid.id}`,postings:{create:[{accountId:fees.id,delta:-3},{accountId:available.id,delta:3}]}}});await tx.referralRedemption.create({data:{couponId:coupon.id,bidId:bid.bid.id,userId:sponsor.id,operationId:op.id,grossFeePoints:10,discountPoints:3}})})).rejects.toThrow();expect(await db.bid.count({where:{userId:sponsor.id}})).toBe(count);expect(await db.referralRedemption.findUnique({where:{couponId:coupon.id}})).toBeNull();expect(await reconcile(db)).toEqual([]);
 });
 it('uses signed first-launch attribution only and ignores existing/unsigned/tampered sources',async()=>{
  const {handleAuth}=await import('../src/modules/auth/handler'),overview=await getReferralOverview(db,sponsor.id),payload=new URL(overview.shareUrl!).searchParams.get('start')!,origin=process.env.BETTER_AUTH_URL!,make=(telegramId:number,fields:Record<string,string>={})=>new Request(origin+'/api/auth/telegram/miniapp/signin?ref='+payload,{method:'POST',headers:{origin:new URL(origin).origin,'content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Signed referral fixture'}),...fields},process.env.TELEGRAM_BOT_TOKEN)})});
  const tid=randomInt(8000000000,8900000000),signed=await handleAuth(make(tid,{start_param:payload}));expect(signed.status).toBe(200);const user=await db.user.findUniqueOrThrow({where:{telegramId:String(tid)}});expect((await db.referralSignup.findUniqueOrThrow({where:{referredUserId:user.id}})).referrerUserId).toBe(sponsor.id);
  expect((await handleAuth(make(other.telegramId,{start_param:payload}))).status).toBe(200);expect(await db.referralSignup.findUnique({where:{referredUserId:other.id}})).toBeNull();
  const unsignedId=randomInt(8000000000,8900000000);expect((await handleAuth(make(unsignedId))).status).toBe(200);const unsigned=await db.user.findUniqueOrThrow({where:{telegramId:String(unsignedId)}});expect(await db.referralSignup.findUnique({where:{referredUserId:unsigned.id}})).toBeNull();
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
  await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE lowwin_runtime');const tid=String(randomInt(8000000000,8900000000)),user=await tx.user.create({data:{id:randomUUID(),name:'Restricted runtime fixture',telegramId:tid}});expect(await tx.referralRegistrationProof.findUnique({where:{userId:user.id}})).not.toBeNull();expect(await tx.referralPolicy.findUnique({where:{id:'default'}})).not.toBeNull();expect(await tx.referralCoupon.count()).toBeGreaterThan(0)});
  await expect(db.referralRegistrationProof.create({data:{userId:other.id}})).rejects.toThrow();
  const permissions=await db.$queryRaw<Array<{table_name:string;delete_allowed:boolean}>>`SELECT t AS table_name,has_table_privilege('lowwin_runtime',format('%I',t),'DELETE') AS delete_allowed FROM unnest(ARRAY['ReferralPolicy','ReferralInvite','ReferralPendingSignup','ReferralSignup','ReferralCoupon','ReferralRedemption','ReferralRegistrationProof']) t`;
  expect(permissions.every(row=>!row.delete_allowed)).toBe(true);expect(await reconcile(db)).toEqual([]);
 });
 it('can quote an owned unspent reward beyond the bounded twenty-item selection list',async()=>{
  const owner=await verifiedReferralUser(db,'Large referral collection fixture');let last='';for(let index=0;index<21;index++)last=(await earnedReferralCoupon(db,owner.id)).coupon.id;
  const auction=await realReferralAuction(db,20),quote=await getBidDiscountQuote(db,owner.id,auction.slug!,last);expect(quote.availableCoupons).toHaveLength(20);expect(quote.availableCoupons.some(c=>c.id===last)).toBe(false);expect(quote.coupon?.id).toBe(last);expect(quote.discountPoints).toBe('2');expect((await getReferralOverview(db,owner.id)).counts.available).toBe(21);expect(await reconcile(db)).toEqual([]);
 },20000);
 it('leaves a real unused preview reward for mobile UI checks and reconciles cleanly',async()=>{
  const preview=await verifiedReferralUser(db,'Referral UI fixture');await creditDevelopmentPoints(db,preview.id,'100',`referral-fixture-${randomUUID()}`);const grant=await earnedReferralCoupon(db,preview.id),auction=await realReferralAuction(db,20);
  mkdirSync('.local',{recursive:true});writeFileSync('.local/referral-preview-fixture.json',JSON.stringify({userId:preview.id,telegramId:preview.telegramId,couponId:grant.coupon.id,auctionSlug:auction.slug,auctionCode:auction.publicCode},null,2)+'\n');expect(await reconcile(db)).toEqual([]);
 });
});
