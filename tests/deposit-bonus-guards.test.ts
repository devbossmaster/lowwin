import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {bidAuction} from './bid-fixtures';
import {TEST_TOKEN} from './helpers';
import {createInlineCheckout} from '../src/modules/payments/chapa-inline';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {chapaHash,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import type {ChapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {processChapaEvent} from '../src/modules/payments/chapa-events';
import {quoteBidBatch,createAndPayBidBatchWallet} from '../src/modules/auctions/batch';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {consumeDepositBonusInTransaction,creditDepositBonusInTransaction,expireDepositBonusLots,listOwnDepositBonuses,quoteDepositBonusInTransaction,readDepositBonusFunds} from '../src/modules/wallet/deposit-bonus';
import {reconcileDepositBonuses} from '../src/modules/wallet/deposit-bonus-reconcile';
import {ensureWallet,seedPlatformAccounts} from '../src/modules/wallet/ledger';

const base=process.env.DEPOSIT_BONUS_GUARD_TEST_DATABASE_URL;
describe.skipIf(!base)('deposit bonus migration and financial guards on isolated PostgreSQL',()=>{
 let db:PrismaClient,sql:Client;
 beforeAll(async()=>{
  const url=new URL(base!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Explicit disposable loopback _test database required');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();const name='lowwin_bonus_guards_'+randomUUID().slice(0,8)+'_test';await admin.query(`CREATE DATABASE "${name}"`);await admin.end();url.pathname='/'+name;
  Object.assign(process.env,{DATABASE_URL:url.href,DIRECT_URL:url.href,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(40),CHAPA_WEBHOOK_SECRET:'c'.repeat(64),CHAPA_INLINE_METHODS:'telebirr',PAYMENT_GATEWAY:'CHAPA',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-bonus-guard-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'bonus-guard',PHONE_CONTACT_KEYS:JSON.stringify({'bonus-guard':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:url.href});sql=new Client({connectionString:url.href});await sql.connect();await sql.query(readFileSync('deploy/runtime-role.sql','utf8'));
  await db.referralPolicy.create({data:{enabled:false,discountPercent:10,expiryDays:30,updatedBy:'isolated-bonus-guard'}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();await sql?.end();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string,kind='available')=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:${kind}`}}))?.balance.toString()??'0';
 async function policy(patch:Record<string,unknown>={}){
  const previous=await db.depositBonusPolicy.findUnique({where:{id:'default'}});
  const data={enabled:true,percent:50,minCents:10000n,maxBonusCents:null,validityDays:7,endsAt:null,version:(previous?.version??0)+1,...patch};
  return db.depositBonusPolicy.upsert({where:{id:'default'},create:data,update:data});
 }
 async function topup(userId?:string,patch:Record<string,unknown>={}){
  const user=userId??(await verifiedReferralUser(db,'Synthetic bonus guard customer')).id,p=await policy(patch),reference='CH'+randomUUID().replaceAll('-','');let merchant='';
  const proof=(status='SUCCESS')=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:10000,currency:'ETB',status,payment_method:'telebirr',mode:'test'}});
  const transport={inline:vi.fn(async(input:{merchantReference:string})=>{merchant=input.merchantReference;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference}}}),create:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{slug:'telebirr',name:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]})),validate:vi.fn(async()=>proof('PENDING')),lookup:vi.fn(async()=>proof())} as unknown as ChapaInlineTransport;
  const bonus=p.enabled?10000n*BigInt(p.percent)/100n:0n,amount=p.maxBonusCents!==null&&bonus>p.maxBonusCents?p.maxBonusCents:bonus;
  const command={key:randomUUID(),purpose:'TOP_UP',flow:'INLINE',paymentMethod:'telebirr',phone:'0911652904',amount:'100.00',approvedDepositBonusVersion:p.version,approvedDepositBonusAmount:new Prisma.Decimal(amount.toString()).div(100).toFixed(2)};
  const {order}=await createInlineCheckout(db,user,command,undefined,transport);
  return {user,order,command,transport,p,verify:()=>verifyChapaCheckout(db,order.id,user,undefined,transport,true)};
 }
 async function ageLot(checkoutId:string){
  // The isolated owner moves only fixture time to exercise seven-day expiry
  // immediately. Production guards are enabled again in the same transaction.
  await sql.query('BEGIN');try{
   await sql.query('ALTER TABLE "DepositBonusLot" DISABLE TRIGGER bonus_immutable');
   await sql.query('WITH stamp AS (SELECT date_trunc(\'milliseconds\',clock_timestamp() AT TIME ZONE \'UTC\') AS moment) UPDATE "DepositBonusLot" SET "createdAt"=stamp.moment-"validityDays"*interval \'1 day\',"expiresAt"=stamp.moment FROM stamp WHERE "checkoutId"=$1',[checkoutId]);
   await sql.query('ALTER TABLE "DepositBonusLot" ENABLE TRIGGER bonus_immutable');await sql.query('COMMIT');
  }catch(error){await sql.query('ROLLBACK');throw error}
 }
 it('credits principal and a separate bonus lot once across duplicate checks and a repeated webhook job',async()=>{
  const f=await topup();await Promise.all([f.verify(),f.verify()]);await f.verify();expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('50');
  const lot=await db.depositBonusLot.findUniqueOrThrow({where:{checkoutId:f.order.id}});expect(lot.expiresAt.getTime()-lot.createdAt.getTime()).toBe(7*86400000);
  const event=await db.chapaWebhookEvent.create({data:{mode:'test',configurationFingerprint:chapaHash('guard-webhook'),bodyHash:chapaHash(randomUUID()),event:'payment.success',checkoutId:f.order.id,status:'QUEUED'}});
  await processChapaEvent(db,event.id,f.transport);await processChapaEvent(db,event.id,f.transport);expect(await db.operation.count({where:{userId:f.user,scope:'DEPOSIT_BONUS'}})).toBe(1);expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
 });
 it('freezes an approved quote through later offer disablement and rejects changed terms before a new dispatch',async()=>{
  const f=await topup();await policy({enabled:false,percent:100});const replay=await createInlineCheckout(db,f.user,f.command,undefined,f.transport);expect(replay.order.id).toBe(f.order.id);expect(f.transport.inline).toHaveBeenCalledOnce();
  expect(await f.verify()).toMatchObject({status:'CREDITED'});expect(await balance(f.user,'bonus')).toBe('50');
  await policy({percent:100});await expect(createInlineCheckout(db,f.user,{...f.command,key:randomUUID()},undefined,f.transport)).rejects.toMatchObject({code:'DEPOSIT_BONUS_CHANGED'});expect(f.transport.inline).toHaveBeenCalledOnce();
 });
 it('keeps a database-timed quote valid when the offer ends just before intent insertion',async()=>{
  const f=await topup(),source=await db.chapaCheckout.findUniqueOrThrow({where:{id:f.order.id}});
  await db.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "DepositBonusPolicy" SET "endsAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '200 milliseconds' WHERE id='default'`;
   const quote=await quoteDepositBonusInTransaction(tx,10000n,true);expect(quote).not.toBeNull();await tx.$queryRaw`SELECT 1 AS waited FROM pg_sleep(0.3)`;
   const nextId=randomUUID(),merchantReference='LW'+randomUUID().replaceAll('-','').slice(0,18),initialization={...(source.initialization as Record<string,Prisma.InputJsonValue>),merchantReference,idempotencyKey:'lowwin-inline:'+nextId,depositBonus:quote!};
   await tx.chapaCheckout.create({data:{...source,receipt:Prisma.DbNull,id:nextId,key:randomUUID(),merchantReference,initialization}});
  });expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(0);
 });
 it.each(['PENDING','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'])('issues no principal or bonus for private provider state %s',async status=>{
  const f=await topup();vi.mocked(f.transport.lookup).mockResolvedValue({status:'success',data:{merchant_reference:f.order.merchantReference,chapa_reference:f.order.authorizationReference,amount:10000,currency:'ETB',status,payment_method:'telebirr',mode:'test'}});
  expect(await f.verify()).toMatchObject({providerStatus:status});expect(await balance(f.user)).toBe('0');expect(await balance(f.user,'bonus')).toBe('0');expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(0);
 });
 it('reconciles a late private success after verified expiry once without refreshing the old prompt',async()=>{
  const f=await topup(),proof=(status:string)=>({status:'success',data:{merchant_reference:f.order.merchantReference,chapa_reference:f.order.authorizationReference,amount:10000,currency:'ETB',status,payment_method:'telebirr',mode:'test'}});
  vi.mocked(f.transport.lookup).mockResolvedValue(proof('EXPIRED'));expect(await f.verify()).toMatchObject({status:'EXPIRED',providerStatus:'EXPIRED'});expect(f.transport.validate).toHaveBeenCalledOnce();
  vi.mocked(f.transport.lookup).mockResolvedValue(proof('SUCCESS'));expect(await f.verify()).toMatchObject({status:'CREDITED'});await f.verify();expect(f.transport.validate).toHaveBeenCalledOnce();expect(f.transport.inline).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('50');expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(1);
 });
 it('rolls principal, operation, and postings back when a promised bonus is omitted',async()=>{
  const f=await topup(),before=await db.journal.count({where:{operation:{userId:f.user}}});
  await expect(db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${f.user}`},0))`;
   await ensureWallet(tx,f.user);await seedPlatformAccounts(tx);
   const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),evidence='d'.repeat(64);
   const op=await tx.operation.create({data:{userId:f.user,scope:'CHAPA_RECEIPT',key:f.order.id,requestHash:evidence,result:{amountCents:'10000'}}}),journal=await tx.journal.create({data:{operationId:op.id,kind:'CHAPA_RECEIPT',reference:'chapa:'+f.order.merchantReference,postings:{create:[{accountId:issuance.id,delta:-100},{accountId:available.id,delta:100}]}}});
   await tx.chapaCheckout.update({where:{id:f.order.id},data:{status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:journal.id,evidenceHash:evidence,chapaReference:'CH'+randomUUID()}});
  })).rejects.toThrow('missing its promised bonus');
  expect(await balance(f.user)).toBe('0');expect(await db.journal.count({where:{operation:{userId:f.user}}})).toBe(before);expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(0);
 });
 it('uses earliest-expiring lots before principal cash for current nonrefundable bid fees',async()=>{
  const first=await topup();await first.verify();const second=await topup(first.user,{percent:20,validityDays:3});await second.verify();const auction=await realReferralAuction(db,30);
  await submitBid(db,{userId:first.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});expect(await balance(first.user)).toBe('200');expect(await balance(first.user,'bonus')).toBe('40');
  expect((await db.depositBonusUse.findMany({where:{userId:first.user},orderBy:{checkoutId:'asc'}})).map(row=>[row.checkoutId,String(row.amountCents)]).sort()).toEqual([[first.order.id,'1000'],[second.order.id,'2000']].sort());
 });
 it('rejects a nullable provider outcome even when a balanced principal and bonus journal are supplied',async()=>{
  const f=await topup();await expect(db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${f.user}`},0))`;const wallet=await ensureWallet(tx,f.user);await seedPlatformAccounts(tx);
   const available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:available`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),evidence='d'.repeat(64);
   const order=await tx.chapaCheckout.findUniqueOrThrow({where:{id:f.order.id}}),op=await tx.operation.create({data:{userId:f.user,scope:'CHAPA_RECEIPT',key:order.id,requestHash:evidence,result:{amountCents:'10000'}}}),journal=await tx.journal.create({data:{operationId:op.id,kind:'CHAPA_RECEIPT',reference:'chapa:'+order.merchantReference,postings:{create:[{accountId:issuance.id,delta:-100},{accountId:available.id,delta:100}]}}});
   await creditDepositBonusInTransaction(tx,order,wallet.id,issuance.id,journal.id,evidence);
   await tx.chapaCheckout.update({where:{id:order.id},data:{status:'CREDITED',providerStatus:null,verificationState:'VERIFIED',creditJournalId:journal.id,evidenceHash:evidence,chapaReference:order.authorizationReference}});
  })).rejects.toThrow('requires its verified principal receipt');expect(await balance(f.user)).toBe('0');expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(0);
 });
 it('excludes expired bonus before cleanup, expires only the remainder once, and preserves principal cash',async()=>{
  const f=await topup();await f.verify();const auction=await realReferralAuction(db,10);await submitBid(db,{userId:f.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});await ageLot(f.order.id);
  expect(await readDepositBonusFunds(db,f.user)).toMatchObject({bonusAvailable:'0',bonusExpiresAt:null});expect(await balance(f.user,'bonus')).toBe('40');
  await Promise.all([expireDepositBonusLots(db),expireDepositBonusLots(db)]);await expireDepositBonusLots(db);expect(await balance(f.user,'bonus')).toBe('0');expect(await balance(f.user)).toBe('100');expect(await db.depositBonusExpiry.findUniqueOrThrow({where:{checkoutId:f.order.id}})).toMatchObject({amountCents:4000n});expect(await db.operation.count({where:{userId:f.user,scope:'DEPOSIT_BONUS_EXPIRY'}})).toBe(1);
 });
 it('serializes concurrent fee spending across auctions without overusing a lot',async()=>{
  const f=await topup();await f.verify();const auctions=await Promise.all([realReferralAuction(db,40),realReferralAuction(db,40)]);
  await Promise.all(auctions.map(auction=>submitBid(db,{userId:f.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()})));
  expect((await db.depositBonusUse.aggregate({where:{userId:f.user},_sum:{amountCents:true}}))._sum.amountCents).toBe(5000n);expect(await balance(f.user,'bonus')).toBe('0');expect(await balance(f.user)).toBe('70');
 });
 it('rejects a bonus bridge larger than the actual accepted fee and rolls the whole bid back',async()=>{
  const f=await topup();await f.verify();const auction=await realReferralAuction(db,10);
  await expect(db.$transaction(async tx=>{const receipt=await submitBidInTransaction(tx,{userId:f.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()},process.env,{allowDepositBonus:false});await consumeDepositBonusInTransaction(tx,{userId:f.user,bidId:receipt.bid.id,netFeeCents:5000n},true)})).rejects.toThrow('only fund an accepted fee');
  expect(await db.bid.count({where:{userId:f.user,auctionId:auction.id}})).toBe(0);expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('50');
 });
 it('keeps legacy holds and fees cash-only and excludes externally funded Chapa bids',async()=>{
  const f=await topup();await f.verify();const legacy=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v3',isDemo:false});await db.product.update({where:{id:legacy.productId!},data:{isDemo:false}});
  await submitBid(db,{userId:f.user,auctionSlug:legacy.slug!,amount:'2',feeVersion:1,key:randomUUID()});expect(await balance(f.user,'bonus')).toBe('50');expect(await balance(f.user)).toBe('88');
  const auction=await realReferralAuction(db,10),quote=await quoteBidBatch(db,f.user,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['4'],feeVersion:1});let merchant='';const reference='CH'+randomUUID().replaceAll('-','');
  const transport={...f.transport,inline:vi.fn(async(input:{merchantReference:string})=>{merchant=input.merchantReference;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference}}}),validate:vi.fn(),lookup:vi.fn(async()=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:1000,currency:'ETB',status:'SUCCESS',payment_method:'telebirr',mode:'test'}}))} as ChapaInlineTransport;
  const {order}=await createInlineCheckout(db,f.user,{key:randomUUID(),purpose:'BID',flow:'INLINE',paymentMethod:'telebirr',phone:'0911652904',batchId:quote.id,quoteHash:quote.quoteHash},undefined,transport);expect(await verifyChapaCheckout(db,order.id,f.user,undefined,transport,true)).toMatchObject({status:'BID_ACCEPTED'});expect(await balance(f.user,'bonus')).toBe('50');expect(await balance(f.user)).toBe('88');expect(await db.depositBonusUse.count({where:{userId:f.user}})).toBe(0);
 });
 it('accepts complete wallet batches using bonus without spending the principal when bonus covers the total',async()=>{
  const f=await topup();await f.verify();const auction=await realReferralAuction(db,10);
  const paid=await createAndPayBidBatchWallet(db,f.user,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','4','6'],feeVersion:1,approvedTotal:'30.00'});expect(paid.kind).toBe('receipt');expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('20');expect(await db.depositBonusUse.count({where:{userId:f.user}})).toBe(3);
 });
 it('combines one referral coupon with a complete bonus-funded batch and caps bonus usage at the net fee',async()=>{
  const f=await topup();await f.verify();await db.referralPolicy.update({where:{id:'default'},data:{enabled:true,discountPercent:10}});const {coupon}=await earnedReferralCoupon(db,f.user),auction=await realReferralAuction(db,10);
  const paid=await createAndPayBidBatchWallet(db,f.user,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','4','6'],feeVersion:1,couponId:coupon.id,approvedTotal:'29.00'});expect(paid.kind).toBe('receipt');expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('21');expect((await db.depositBonusUse.aggregate({where:{userId:f.user},_sum:{amountCents:true}}))._sum.amountCents).toBe(2900n);expect(await db.referralRedemption.count({where:{userId:f.user}})).toBe(1);
 });
 it('records exhausted-lot expiry without a zero journal and rejects another owner claiming that expiry',async()=>{
  const f=await topup();await f.verify();const auction=await realReferralAuction(db,50);await submitBid(db,{userId:f.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});await ageLot(f.order.id);
  const other=await db.user.create({data:{id:randomUUID(),name:'Synthetic wrong expiry owner'}});await expect(db.depositBonusExpiry.create({data:{checkoutId:f.order.id,userId:other.id,amountCents:0n}})).rejects.toThrow('Invalid exhausted bonus expiry');
  await expireDepositBonusLots(db);expect(await db.depositBonusExpiry.findUniqueOrThrow({where:{checkoutId:f.order.id}})).toMatchObject({amountCents:0n,journalId:null});expect(await db.operation.count({where:{userId:f.user,scope:'DEPOSIT_BONUS_EXPIRY'}})).toBe(0);expect(await balance(f.user)).toBe('100');
 });
 it('skips a busy wallet during expiry so payment work does not wait for a cleanup lock',async()=>{
  const f=await topup();await f.verify();await ageLot(f.order.id);const blocker=new Client({connectionString:process.env.DATABASE_URL});await blocker.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`wallet:${f.user}`]);
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([expireDepositBonusLots(db),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Bonus cleanup blocked behind payment wallet lock')),2000)})]);expect(await db.depositBonusExpiry.count({where:{checkoutId:f.order.id}})).toBe(0)}
  finally{clearTimeout(timeout);await blocker.query('ROLLBACK');await blocker.end()}
  await expireDepositBonusLots(db);expect(await db.depositBonusExpiry.count({where:{checkoutId:f.order.id}})).toBe(1);expect(await balance(f.user)).toBe('100');
 });
 it('enforces immutable lots, nonnegative bonus, account ownership, and server-only minimal grants',async()=>{
  const f=await topup();await f.verify();await expect(db.depositBonusLot.update({where:{checkoutId:f.order.id},data:{amountCents:1n}})).rejects.toThrow('Immutable');await expect(db.depositBonusLot.delete({where:{checkoutId:f.order.id}})).rejects.toThrow('Immutable');
  const wallet=await db.wallet.findUniqueOrThrow({where:{userId:f.user}});await expect(db.ledgerAccount.create({data:{name:'wrong-bonus-owner',kind:'BONUS',walletId:wallet.id}})).rejects.toThrow('must match its wallet owner');
  await expect(db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${f.user}`},0))`;const bonus=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:bonus`}}),cash=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:available`}}),op=await tx.operation.create({data:{userId:f.user,scope:'SYNTHETIC_BONUS_OVERDRAW',key:randomUUID(),requestHash:'e'.repeat(64),result:{}}});await tx.journal.create({data:{operationId:op.id,kind:'SYNTHETIC_BONUS_OVERDRAW',reference:'synthetic-bonus-overdraw',postings:{create:[{accountId:bonus.id,delta:-51},{accountId:cash.id,delta:51}]}}})})).rejects.toThrow('nonnegative_user_balance');expect(await balance(f.user,'bonus')).toBe('50');
  const rights=(await sql.query(`SELECT has_table_privilege('lowwin_runtime','"DepositBonusPolicy"','UPDATE') AS policy,has_table_privilege('lowwin_runtime','"DepositBonusLot"','SELECT,INSERT') AS lot,has_table_privilege('lowwin_runtime','"DepositBonusLot"','UPDATE,DELETE,TRUNCATE') AS mutation,(SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('DepositBonusPolicy','DepositBonusLot','DepositBonusUse','DepositBonusExpiry')) AS rls`)).rows[0];expect(rights).toEqual({policy:true,lot:true,mutation:false,rls:true});
  expect((await sql.query(`SELECT grantee FROM information_schema.table_privileges WHERE table_name IN ('DepositBonusPolicy','DepositBonusLot','DepositBonusUse','DepositBonusExpiry') AND grantee IN ('PUBLIC','anon','authenticated')`)).rows).toEqual([]);
 });
 it('paginates only owned credited bonus lots and reconciles the separate liability without drift',async()=>{
  const first=await topup();await first.verify();for(let index=0;index<20;index++){const next=await topup(first.user);await next.verify()}
  const page1=await listOwnDepositBonuses(db,first.user,{page:1}),page2=await listOwnDepositBonuses(db,first.user,{page:2});expect(page1.items).toHaveLength(20);expect(page1.nextPage).toBe(2);expect(page2.items).toHaveLength(1);expect(page2.nextPage).toBeNull();expect(new Set([...page1.items,...page2.items].map(item=>item.id)).size).toBe(21);expect(page1.items.every(item=>item.status==='active'&&item.remaining==='50.00')).toBe(true);
  expect((await listOwnDepositBonuses(db,'another-private-owner')).items).toEqual([]);await expect(listOwnDepositBonuses(db,first.user,{page:0})).rejects.toThrow();expect(await reconcileDepositBonuses(db)).toEqual([]);
 });
 it('refuses the historical cash-reset guard for bonus-funded fees without moving either balance',async()=>{
  const f=await topup();await f.verify();const auction=await realReferralAuction(db,10);await submitBid(db,{userId:f.user,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});
  const source=readFileSync('scripts/sql/auction-reset-execute.sql','utf8'),guard=source.split('-- BEGIN DEPOSIT BONUS RESET GUARD')[1].split('-- END DEPOSIT BONUS RESET GUARD')[0],config=JSON.stringify({auctions:[{id:auction.id}]}).replaceAll("'","''");
  await expect(sql.query(`DO $bonus_reset_test$ DECLARE c jsonb := '${config}'::jsonb;bonus_funded boolean;BEGIN ${guard} END $bonus_reset_test$`)).rejects.toThrow('source-preserving compensation review');expect(await balance(f.user)).toBe('100');expect(await balance(f.user,'bonus')).toBe('40');
 });
});
