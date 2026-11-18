import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createAndPayBidBatchWallet,getOwnWalletBidBatch,normalizeBatchNumbers} from '../src/modules/auctions/batch';
import {runAtomicCashWalletCommand,type WalletCashCommandInput} from '../src/modules/auctions/wallet-cash-command';
import {chapaHash} from '../src/modules/payments/chapa-provider';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {readWalletProjection} from '../src/modules/wallet/balance';
import {bidAuction} from './bid-fixtures';
import {verifiedReferralUser,referredRegistration} from './referral-fixtures';
import {contactBotId} from '../src/modules/auth/own-contact';
import {bidPurchaseNotificationCopy} from '../src/modules/notifications/amharic-copy';
import {createInlineCheckout} from '../src/modules/payments/chapa-inline';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import type {ChapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {TEST_TOKEN} from './helpers';

const base=process.env.WALLET_BATCH_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!base)('one-call cash wallet command with real PostgreSQL guards',()=>{
 let db:PrismaClient,sql:Client,database:string,name:string;
 let outbound:ReturnType<typeof vi.spyOn>;
 beforeAll(async()=>{
  const url=new URL(base!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  name='lowwin_cash_command_'+randomUUID().replaceAll('-','').slice(0,12)+'_test';await admin.query(`CREATE DATABASE "${name}"`);await admin.end();url.pathname='/'+name;database=url.href;
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',PAYMENTS_LIVE_ENABLED:'false',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'c'.repeat(40),CHAPA_WEBHOOK_SECRET:'b'.repeat(64),CHAPA_INLINE_METHODS:'telebirr',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-cash-wallet-webhook-thirty-two',PHONE_CONTACT_KEY_ID:'cash-command',PHONE_CONTACT_KEYS:JSON.stringify({'cash-command':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true',REDIS_URL:''});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});sql=new Client({connectionString:database});await sql.connect();
  await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'cash-command-fixture'}});
  outbound=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Real network prohibited in cash wallet tests'));
 },60000);
 afterAll(async()=>{
  outbound?.mockRestore();await db?.$disconnect();await sql?.end();const shared=await import('../src/lib/db');await shared.db.$disconnect();
  if(name){const u=new URL(base!);u.pathname='/postgres';const admin=new Client({connectionString:u.href});await admin.connect();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end()}
 });
 async function fixture(options:{numbers?:string[];fee?:number;cash?:string;ruleVersion?:string;userId?:string;endDelayMs?:number}={}){
  const user=options.userId?await db.user.findUniqueOrThrow({where:{id:options.userId},select:{id:true,telegramId:true}}):await verifiedReferralUser(db);
  const auction=await bidAuction(db,{ruleVersion:options.ruleVersion??'lowest-unique-v5',fee:options.fee??10,isDemo:false,endDelayMs:options.endDelayMs??3600000});
  await db.product.update({where:{id:auction.productId!},data:{isDemo:false,title:'Cash wallet fixture',titleAm:'የዋሌት ሙከራ'}});
  if(options.cash!=='0')await creditDevelopmentPoints(db,user.id,options.cash??'1000',randomUUID());
  const session=await db.session.create({data:{id:randomUUID(),token:randomUUID(),userId:user.id,expiresAt:new Date(Date.now()+3600000),telegramLaunchId:String(user.telegramId),telegramAuthSource:'MINI_APP'}});
  const binding={sessionId:session.id,sessionToken:session.token,userId:user.id,telegramId:String(user.telegramId),telegramAuthSource:'MINI_APP',botId:contactBotId()};
  const numbers=options.numbers??['2','3'],command={key:randomUUID(),auctionSlug:auction.slug!,numbers,feeVersion:1,approvedTotal:new Prisma.Decimal(options.fee??10).mul(numbers.length).toFixed(2)};
  const authorize:any=async(tx:Prisma.TransactionClient)=>{const valid=await tx.session.findFirst({where:{id:session.id,token:session.token,userId:user.id,expiresAt:{gt:new Date()},telegramLaunchId:String(user.telegramId),telegramAuthSource:'MINI_APP',user:{is:{telegramId:String(user.telegramId),staffMember:{is:null},ownContact:{is:{telegramId:String(user.telegramId),botId:binding.botId,revokedAt:null}}}}},select:{id:true}});if(!valid)throw Error('Fixture session no longer authorized')};
  authorize.forWalletCashCommand=vi.fn((client:PrismaClient,owner:string,input:WalletCashCommandInput)=>runAtomicCashWalletCommand(client,binding,owner,input));
  const fastInput=(patch:Partial<typeof command>={})=>{const raw={...command,...patch},normalized={...raw,numbers:normalizeBatchNumbers(raw.numbers)};return {...normalized,requestHash:chapaHash(JSON.stringify(normalized))}};
  return {user,auction,session,binding,command,authorize,fastInput,pay:(patch:Partial<typeof command>={})=>createAndPayBidBatchWallet(db,user.id,{...command,...patch},authorize),fast:(patch:Partial<typeof command>={})=>runAtomicCashWalletCommand(db,binding,user.id,fastInput(patch))};
 }
 async function effects(userId:string){return{bids:await db.bid.count({where:{userId}}),operations:await db.operation.count({where:{userId,scope:'BID'}}),journals:await db.journal.count({where:{operation:{userId,scope:'BID'}}}),batches:await db.bidBatchOrder.count({where:{userId}}),outbox:await db.outbox.count({where:{payload:{path:['recipientUserId'],equals:userId}}}),inbox:await db.notificationInbox.count({where:{userId}}),wallet:await readWalletProjection(db,userId)}}
 it('commits one fresh owned command with one Prisma operation and exact ledger-backed receipt',async()=>{
  const f=await fixture({numbers:['4.25']}),operations:string[]=[];
  const measured=db.$extends({query:{$allOperations:async({model,operation,args,query})=>{operations.push((model??'$raw')+'.'+operation);return query(args)}}}) as unknown as PrismaClient;
  const paid=await createAndPayBidBatchWallet(measured,f.user.id,f.command,f.authorize);expect(operations).toEqual(['$raw.$queryRaw']);expect(paid.kind).toBe('receipt');
  if(paid.kind!=='receipt')throw Error('Committed receipt required');
  expect(paid.receipt).toMatchObject({batch:{status:'ACCEPTED',ruleVersion:'lowest-unique-v5',total:'10.00'},wallet:{available:'990.00',held:'0.00'},payment:{method:'wallet',gateway:'INTERNAL_WALLET',total:'10.00'}});
  expect(await getOwnWalletBidBatch(db,f.user.id,{key:f.command.key})).toEqual(paid);expect(await reconcile(db)).toEqual([]);expect(outbound).not.toHaveBeenCalled();
 });
 it('preserves V4 terms and canonical batch/child hashes without changing historical policy',async()=>{
  const f=await fixture({ruleVersion:'lowest-unique-v4'}),paid=await f.pay();if(paid.kind!=='receipt')throw Error('Receipt required');
  expect(paid.receipt.batch.ruleVersion).toBe('lowest-unique-v4');const batch=await db.bidBatchOrder.findUniqueOrThrow({where:{id:paid.receipt.batch.id}});
  const lines=(batch.lines as Array<{position:number;number:string;grossFee:string;discount:string;netFee:string}>).map(line=>({position:line.position,number:line.number,grossFee:line.grossFee,discount:line.discount,netFee:line.netFee}));
  expect(batch.quoteHash).toBe(chapaHash(JSON.stringify({id:batch.id,userId:f.user.id,ruleVersion:batch.ruleVersion,feeVersion:1,lines,totalCents:String(batch.totalCents)})));
  expect((await effects(f.user.id)).wallet.available).toBe('980');expect(await reconcile(db)).toEqual([]);
 });
 it('accepts all100 contiguous numbers atomically using the original database acceptance triggers',async()=>{
  const f=await fixture({numbers:Array.from({length:100},(_,i)=>(100+i).toString()),fee:1}),paid=await f.pay();if(paid.kind!=='receipt')throw Error('Receipt required');
  expect(paid.receipt.receipts).toHaveLength(100);expect(new Set(paid.receipt.payment.acceptedBidIds).size).toBe(100);expect((await effects(f.user.id)).wallet.available).toBe('900');
  expect((await db.auction.findUniqueOrThrow({where:{id:f.auction.id}})).acceptedBidCount).toBe(100);expect(await reconcile(db)).toEqual([]);
 });
 it('serializes duplicate concurrent requests, then replays without advancing wallet state',async()=>{
  const f=await fixture(),results=await Promise.all([f.pay(),f.pay(),f.pay()]);
  const ids=results.map(r=>r.kind==='receipt'?r.receipt.payment.acceptedBidIds:[]);expect(ids[0]).toHaveLength(2);expect(ids[1]).toEqual(ids[0]);expect(ids[2]).toEqual(ids[0]);
  const before=await effects(f.user.id);expect(await f.fast()).toBeNull();expect(await effects(f.user.id)).toEqual(before);await f.pay();expect(await effects(f.user.id)).toEqual(before);
 });
 it('preserves a committed original after an ambiguous lost reply without executing a fallback mutation',async()=>{
  const f=await fixture(),unknown=new Proxy(db,{get(target,key){if(key==='$queryRaw')return async(...args:unknown[])=>{await (target.$queryRaw as (...a:unknown[])=>Promise<unknown>)(...args);throw new TypeError('Lost reply after commit')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}});
  await expect(createAndPayBidBatchWallet(unknown,f.user.id,f.command,f.authorize)).rejects.toThrow('Lost reply after commit');
  const original=await getOwnWalletBidBatch(db,f.user.id,{key:f.command.key});expect(original.kind).toBe('receipt');expect((await effects(f.user.id)).bids).toBe(2);expect((await effects(f.user.id)).wallet.available).toBe('980');expect(await reconcile(db)).toEqual([]);
 });
 it('retains invalid/duplicate/changed-key and insufficient-funds error precedence with no partial debit',async()=>{
  const f=await fixture({cash:'5'}),before=await effects(f.user.id);expect(await f.fast()).toBeNull();expect(await effects(f.user.id)).toEqual(before);
  await expect(f.pay({numbers:['0.50'],approvedTotal:'10.00'})).rejects.toMatchObject({code:'INVALID_AMOUNT'});expect(await effects(f.user.id)).toEqual(before);
  await expect(f.pay()).rejects.toMatchObject({code:'INSUFFICIENT_POINTS'});expect((await effects(f.user.id)).bids).toBe(0);
  const good=await fixture({numbers:['2']}),paid=await good.pay();expect(paid.kind).toBe('receipt');
  await expect(good.pay({key:randomUUID()})).rejects.toMatchObject({code:'OWN_DUPLICATE'});await expect(good.pay({numbers:['3']})).rejects.toMatchObject({code:'KEY_REUSED'});expect((await effects(good.user.id)).bids).toBe(1);
 });
 it('falls back before writes on a changed approved total and returns the original quote contract',async()=>{
  const f=await fixture(),before=await effects(f.user.id);expect(await f.fast({approvedTotal:'22.00'})).toBeNull();expect(await effects(f.user.id)).toEqual(before);
  expect(await f.pay({approvedTotal:'22.00'})).toMatchObject({kind:'quote',quote:{total:'20.00',status:'QUOTED'}});expect((await effects(f.user.id)).bids).toBe(0);
 });
 it('retains first-paid referral qualification and rejects the accelerated path without writes',async()=>{
  const sponsor=await verifiedReferralUser(db),referred=await referredRegistration(db,sponsor.id),f=await fixture({userId:referred.id,numbers:['2']}),before=await effects(f.user.id);
  expect(await f.fast()).toBeNull();expect(await effects(f.user.id)).toEqual(before);expect((await f.pay()).kind).toBe('receipt');
  expect((await db.referralSignup.findUniqueOrThrow({where:{referredUserId:f.user.id}})).firstBidId).not.toBeNull();expect(await db.referralCoupon.count({where:{ownerUserId:sponsor.id,referredUserId:f.user.id}})).toBe(1);expect(await reconcile(db)).toEqual([]);
  const coupon=await db.referralCoupon.findUniqueOrThrow({where:{referredUserId:f.user.id}}),owner=await fixture({userId:sponsor.id,numbers:['7']});
  expect(await createAndPayBidBatchWallet(db,owner.user.id,{...owner.command,couponId:coupon.id,approvedTotal:'9.00'},owner.authorize)).toMatchObject({kind:'receipt',receipt:{payment:{total:'9.00'}}});
  expect(owner.authorize.forWalletCashCommand).not.toHaveBeenCalled();expect(await db.referralRedemption.count({where:{couponId:coupon.id}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps notification preference and the shared authored product/number/actual-fee copy',async()=>{
  const f=await fixture({numbers:['4.25','5.50']}),paid=await f.pay();if(paid.kind!=='receipt')throw Error('Receipt required');
  const copy=bidPurchaseNotificationCopy({productTitle:'የዋሌት ሙከራ',numbers:f.command.numbers,paidFee:'20.00',ruleVersion:'lowest-unique-v5'})!;
  expect(await db.notificationInbox.findUniqueOrThrow({where:{key:`bid-batch:${paid.receipt.batch.id}:accepted`}})).toMatchObject({title:copy.title,body:copy.body,href:'/my-bids'});
  const muted=await fixture();await db.notificationPreference.create({data:{userId:muted.user.id,inApp:false}});await muted.pay();expect((await effects(muted.user.id)).outbox).toBe(1);expect((await effects(muted.user.id)).inbox).toBe(0);
 });
 it('waits on the hold-state guard, then reads fresh balances before accepting or declining',async()=>{
  const f=await fixture({numbers:['2']}),wallet=await db.wallet.findUniqueOrThrow({where:{userId:f.user.id}});let acquired!:()=>void,release!:()=>void;
  const ready=new Promise<void>(done=>{acquired=done}),gate=new Promise<void>(done=>{release=done});
  const writer=db.$transaction(async tx=>{await tx.$executeRaw`SELECT lock_wallet_hold_state(${wallet.id})`;acquired();await gate;const account=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user.id}:available`}}),funding=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),operation=await tx.operation.create({data:{userId:f.user.id,scope:'DEV_CREDIT',key:randomUUID(),requestHash:chapaHash('7'),result:{available:'1007',credited:'7'}}});await tx.journal.create({data:{operationId:operation.id,kind:'DEV_CREDIT',reference:`DEV_CREDIT:${operation.id}`,postings:{create:[{accountId:funding.id,delta:-7},{accountId:account.id,delta:7}]}}})},{timeout:15000});void writer.catch(()=>{});
  await ready;const pending=f.pay();void pending.catch(()=>{});
  try{await vi.waitFor(async()=>{const [row]=await db.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%lowwin_cash_wallet_batch%') AS waiting`;expect(row.waiting).toBe(true)},{timeout:3000,interval:25});release();await writer;const result=await pending;expect(result).toMatchObject({kind:'receipt',receipt:{wallet:{available:'997.00'}}});expect(await reconcile(db)).toEqual([])}finally{release();await Promise.allSettled([writer,pending])}
 });
 it('rechecks revocation after waiting for the auction lock and cannot accept after the deadline',async()=>{
  const f=await fixture({numbers:['2']});let acquired!:()=>void,release!:()=>void;const ready=new Promise<void>(done=>{acquired=done}),gate=new Promise<void>(done=>{release=done});
  const held=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${f.auction.id} FOR UPDATE`;acquired();await gate;await tx.session.delete({where:{id:f.session.id}})},{timeout:15000});void held.catch(()=>{});await ready;const pending=f.pay();void pending.catch(()=>{});
  try{await vi.waitFor(async()=>{const [row]=await db.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%lowwin_cash_wallet_batch%') AS waiting`;expect(row.waiting).toBe(true)},{timeout:3000,interval:25});release();await held;await expect(pending).rejects.toMatchObject({status:401});expect((await effects(f.user.id)).bids).toBe(0)}finally{release();await Promise.allSettled([held,pending])}
  const expired=await fixture({numbers:['2'],endDelayMs:1});await new Promise(done=>setTimeout(done,10));await expect(expired.pay()).rejects.toMatchObject({code:'AUCTION_CLOSED'});expect((await effects(expired.user.id)).bids).toBe(0);
 });
 it('rolls back every bid, journal, posting, receipt and notification when a later insertion fails',async()=>{
  const f=await fixture({numbers:['2','3']}),suffix=randomUUID().replaceAll('-',''),routine='cash_fail_'+suffix,trigger='cash_fail_'+suffix;
  await sql.query(`CREATE FUNCTION "${routine}"() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW."userId"='${f.user.id.replaceAll("'","''")}' AND NEW.amount=3 THEN RAISE EXCEPTION 'Injected later cash batch failure'; END IF;RETURN NEW;END $$`);await sql.query(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "Bid" FOR EACH ROW EXECUTE FUNCTION "${routine}"()`);
  const before=await effects(f.user.id);try{await expect(f.pay()).rejects.toThrow('Injected later cash batch failure');expect(await effects(f.user.id)).toEqual(before);expect(await reconcile(db)).toEqual([])}finally{await sql.query(`DROP TRIGGER "${trigger}" ON "Bid"`);await sql.query(`DROP FUNCTION "${routine}"()`)}
 });
 it('bounds a blocked command and propagates lock timeout without starting the fallback transaction',async()=>{
  const f=await fixture({numbers:['2']}),before=await effects(f.user.id);let acquired!:()=>void,release!:()=>void;
  const ready=new Promise<void>(done=>{acquired=done}),gate=new Promise<void>(done=>{release=done});
  // Shorten only this isolated database's function configuration; production
  // keeps the migration's5s lock bound. No financial trigger is disabled.
  await sql.query("ALTER FUNCTION public.lowwin_cash_wallet_batch(jsonb,jsonb) SET lock_timeout='150ms'");
  const held=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${f.auction.id} FOR UPDATE`;acquired();await gate},{timeout:10000});void held.catch(()=>{});await ready;
  try{await expect(f.pay()).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});expect(f.authorize.forWalletCashCommand).toHaveBeenCalledOnce();expect(await effects(f.user.id)).toEqual(before)}
  finally{release();await held;await sql.query("ALTER FUNCTION public.lowwin_cash_wallet_batch(jsonb,jsonb) SET lock_timeout='5s'")}
 });
 it('executes under the restricted non-owner runtime role with all original triggers and no PUBLIC grant',async()=>{
  const f=await fixture({numbers:['2']}),role='cash_runtime_'+randomUUID().replaceAll('-','').slice(0,12);
  await sql.query(readFileSync('deploy/runtime-role.sql','utf8'));await sql.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);await sql.query(`GRANT lowwin_runtime TO "${role}"`);
  try{
   const result=await db.$transaction(async tx=>{await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);return runAtomicCashWalletCommand(tx as unknown as PrismaClient,f.binding,f.user.id,f.fastInput())});expect(result?.kind).toBe('receipt');
   const [access]=await db.$queryRaw<Array<{owner:boolean;volatile:boolean;publicExecute:boolean}>>`SELECT p.prosecdef AS owner,p.provolatile='v' AS volatile,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute" FROM pg_proc p WHERE p.oid='public.lowwin_cash_wallet_batch(jsonb,jsonb)'::regprocedure`;
   expect(access).toEqual({owner:false,volatile:true,publicExecute:false});expect(await reconcile(db)).toEqual([]);
  }finally{await sql.query(`DROP ROLE "${role}"`)}
 });
 it('preserves live bonus accounting by declining without writes before the original complete payment',async()=>{
  const f=await fixture({numbers:['2']}),policy=await db.depositBonusPolicy.upsert({where:{id:'default'},create:{enabled:true,percent:50,minCents:10000n,validityDays:7,version:1},update:{enabled:true,percent:50,minCents:10000n}}),reference='CH'+randomUUID().replaceAll('-','');let merchant='';
  const proof=(status='SUCCESS')=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:10000,currency:'ETB',status,payment_method:'telebirr',mode:'test'}});
  const transport={inline:vi.fn(async(input:{merchantReference:string})=>{merchant=input.merchantReference;return{status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference}}}),create:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{slug:'telebirr',name:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]})),validate:vi.fn(async()=>proof('PENDING')),lookup:vi.fn(async()=>proof())} as unknown as ChapaInlineTransport;
  const {order}=await createInlineCheckout(db,f.user.id,{key:randomUUID(),purpose:'TOP_UP',flow:'INLINE',paymentMethod:'telebirr',phone:'0911652904',amount:'100.00',approvedDepositBonusVersion:policy.version,approvedDepositBonusAmount:'50.00'},undefined,transport);expect(await verifyChapaCheckout(db,order.id,f.user.id,undefined,transport,true)).toMatchObject({status:'CREDITED'});
  const before=await effects(f.user.id);expect(await f.fast()).toBeNull();expect(await effects(f.user.id)).toEqual(before);expect((await f.pay()).kind).toBe('receipt');expect(await db.depositBonusUse.count({where:{userId:f.user.id}})).toBeGreaterThan(0);expect(await reconcile(db)).toEqual([]);
  const consume=await fixture({userId:f.user.id,fee:40,numbers:['9'],cash:'0'});expect((await consume.pay()).kind).toBe('receipt');expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user.id}:bonus`}})).balance.toString()).toBe('0');
  const zeroBonus=await fixture({userId:f.user.id,numbers:['8'],cash:'0'}),zeroBefore=await effects(f.user.id);expect(await zeroBonus.fast()).toBeNull();expect(await effects(f.user.id)).toEqual(zeroBefore);
 });
});
