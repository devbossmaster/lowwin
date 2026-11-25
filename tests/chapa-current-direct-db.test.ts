import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {makeSignature} from 'better-auth/crypto';
import {earnedReferralCoupon,verifiedReferralUser,realReferralAuction} from './referral-fixtures';
import {seedLegacyCouponQuote} from './legacy-coupon-fixtures';
import {quoteBidBatch} from '../src/modules/auctions/batch';
import {createCurrentDirectCheckout,findCurrentDirectCheckoutByKey,findInlineCheckoutByKey,prepareCurrentDirectCreation,tryCreateCurrentDirectCheckout} from '../src/modules/payments/chapa-inline';
import {prepareAtomicDirectBid} from '../src/modules/payments/chapa-direct-bid-prepare';
import {prepareAtomicDirectTopUp} from '../src/modules/payments/chapa-direct-topup-prepare';
import {prepareOwnedChapaVerification,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {authorizeCurrentDirectCreation,type PaymentSessionAuthorizer} from '../src/modules/payments/creation-eligibility';
import {contactBotId} from '../src/modules/auth/own-contact';
import {authorizeDirectCheckout} from '../src/modules/payments/chapa-direct';
import {ChapaProviderError,chapaHash,chapaTransport,type ChapaDirectCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {directMethodCatalog} from '../src/modules/payments/chapa-direct-methods';
import {allowIdentityRequest} from '../src/lib/rate-limit';
import {reconcile} from '../src/modules/wallet/ledger';
import {type ChapaCompletionStatus} from '../src/modules/payments/chapa-verification-policy';
import {chapaPollingDeadline} from '../src/lib/chapa-client';
import {TEST_TOKEN} from './helpers';
const database=process.env.CHAPA_CURRENT_DIRECT_TEST_DATABASE_URL;
const sessionSecret='isolated-direct-verification-fixture-secret';

describe.skipIf(!database)('current Direct5 owned creation and private committed fulfillment',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const url=new URL(database!);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Fresh isolated loopback test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'',CHAPA_WEBHOOK_SECRET:'c'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_INLINE_ENABLED:'false',CHAPA_WEBHOOK_SIGNATURE_PROFILE:'raw_body',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-direct-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'direct-test',PHONE_CONTACT_KEYS:JSON.stringify({'direct-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-direct-owner'}});
 },60000);
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:available`}}))?.balance.toString()??'0';
 async function fixture(purpose:'TOP_UP'|'BID'='TOP_UP',endDelayMs=3600000){
  const user=(await verifiedReferralUser(db)).id,auction=purpose==='BID'?await realReferralAuction(db,20,endDelayMs):null,quote=auction?await quoteBidBatch(db,user,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','4'],feeVersion:1}):null;
  const command={key:randomUUID(),purpose,flow:'DIRECT',paymentMethod:'telebirr',phone:'0911652904',...(quote?{batchId:quote.id,quoteHash:quote.quoteHash}:{amount:'40.00'})};
  let id='',merchant='',status='PENDING',validationStatus='PENDING',authType='USSD',initializationStatus='PENDING',capable=true,patch:Record<string,unknown>={},initializationDates:Record<string,string>={};const reference='CH'+randomUUID();
  const proof=()=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:4000,currency:'ETB',status,mode:'test',payment_method:'telebirr',meta:{checkout_id:id},...patch}});
  const direct=vi.fn(async(request:ChapaDirectCreate)=>{merchant=request.merchantReference;const row=await db.chapaCheckout.findUniqueOrThrow({where:{merchantReference:merchant}});id=row.id;expect(request.metadata).toEqual({checkout_id:id});expect(row.flowVersion).toBe(5);return {status:'success',data:{auth_type:authType,chapa_reference:reference,payment_status:initializationStatus,request_id:'req_'+randomUUID(),expires_at:new Date(Date.now()+300000).toISOString(),...initializationDates}}});
  const lookup=vi.fn(async()=>proof()),validate=vi.fn(async(_input:{reference:string;paymentMethod:string;otp?:string})=>({...proof(),data:{...proof().data,status:validationStatus}}));
  const transport:ChapaTransport={direct,lookup,validate,create:vi.fn(async()=>{throw Error('Hosted creation is forbidden')}),methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:capable,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]}))};
  const due=()=>db.chapaCheckout.update({where:{id},data:{nextCheckAt:new Date(0),verificationRetryAfter:null}});
  return {user,auction,quote,command,transport,direct,lookup,validate,id:()=>id,proof,start:(change:Record<string,unknown>={})=>createCurrentDirectCheckout(db,user,{...command,...change},undefined,transport),due,verify:async()=>{await due();return verifyChapaCheckout(db,id,user,undefined,transport)},setStatus:(value:string)=>{status=value},setValidation:(value:string)=>{validationStatus=value},setAuth:(value:string)=>{authType=value},setInitializationStatus:(value:string)=>{initializationStatus=value},setInitializationDates:(value:Record<string,string>)=>{initializationDates=value},setCapable:(value:boolean)=>{capable=value},alter:(value:Record<string,unknown>)=>{patch=value}};
 }
 async function creationBinding(userId:string){
  const {telegramId}=await db.user.findUniqueOrThrow({where:{id:userId},select:{telegramId:true}});
  const session=await db.session.create({data:{id:randomUUID(),token:randomUUID(),userId,expiresAt:new Date(Date.now()+60000),telegramLaunchId:telegramId,telegramAuthSource:'MINI_APP'}});
  const binding={sessionId:session.id,sessionToken:session.token,userId,telegramId:telegramId!,telegramAuthSource:session.telegramAuthSource,botId:contactBotId()};
  const authorize:PaymentSessionAuthorizer=vi.fn(async()=>{});
  authorize.forCurrentDirectCreate=vi.fn((tx,owner,key)=>authorizeCurrentDirectCreation(tx,binding,owner,key));
  authorize.forCurrentDirectBid=vi.fn((client,owner,input)=>prepareAtomicDirectBid(client,binding,owner,input));
  authorize.forCurrentDirectTopUp=vi.fn((client,owner,input)=>prepareAtomicDirectTopUp(client,binding,owner,input));
  return {session,authorize,binding};
 }
 async function signedHeaders(token:string){
  process.env.BETTER_AUTH_SECRET=sessionSecret;
  const cookie='__Secure-better-auth.session_token='+encodeURIComponent(`${token}.${await makeSignature(token,sessionSecret)}`);
  return new Headers({cookie});
 }
 async function ownedVerification(f:Awaited<ReturnType<typeof fixture>>,id:string){
  const {session}=await creationBinding(f.user);
  const {requirePaymentSessionWithRead}=await import('../src/modules/payments/session');
  const {prepared,reauthorize}=await requirePaymentSessionWithRead(
   new Request(`https://lowwin.test/api/payments/chapa/checkouts/${id}`,{method:'POST',headers:await signedHeaders(session.token)}),
   userId=>prepareOwnedChapaVerification(db,id,userId,f.transport),
  );
  const transactionAuthorization=Object.assign(vi.fn(reauthorize),reauthorize);
  return {session,transactionAuthorization,verify:()=>prepared(transactionAuthorization)};
 }
 it.each(['TOP_UP','BID'] as const)('authorizes and commits a fresh Direct %s in one statement before dispatch',async purpose=>{
  const f=await fixture(purpose),{session}=await creationBinding(f.user),headers=await signedHeaders(session.token);
  const operations:string[]=[];
  const client=db.$extends({query:{
   $queryRaw:async({args,query})=>{operations.push('$queryRaw');return query(args)},
   $allModels:{$allOperations:async({operation,args,query})=>{operations.push(operation);return query(args)}},
  }}) as unknown as PrismaClient;
  let operationsAtDispatch:string[]=[];
  let savedState:string|undefined;
  const methods=vi.spyOn(chapaTransport,'methods').mockImplementation(f.transport.methods);
  const direct=vi.spyOn(chapaTransport,'direct').mockImplementation(async input=>{
   operationsAtDispatch=[...operations];
   savedState=(await db.chapaCheckout.findUniqueOrThrow({where:{merchantReference:input.merchantReference}})).status;
   return f.direct(input);
  });
  try{
   await directMethodCatalog.get();
   await expect(tryCreateCurrentDirectCheckout(client,new Headers({cookie:'__Secure-better-auth.session_token=unsigned'}),f.command)).resolves.toBeNull();
   expect(direct).not.toHaveBeenCalled();
   expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
   operations.length=0;

   const created=await tryCreateCurrentDirectCheckout(client,headers,f.command);
   expect(created?.order).toMatchObject({purpose,flowVersion:5,status:'AUTH_NEEDED',amount:'40.00'});
   expect(operationsAtDispatch).toEqual(['$queryRaw']);
   expect(savedState).toBe('SUBMITTING');
   expect(direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({amountCents:'4000',idempotencyKey:`lowwin-direct-v5:${created!.order.id}`}), 'create');
   const limit=`app:mutation:${chapaHash(f.user)}`;
   expect((await db.rateLimit.findUniqueOrThrow({where:{key:limit}})).count).toBe(1);

   await expect(tryCreateCurrentDirectCheckout(client,headers,f.command)).resolves.toBeNull();
   expect(direct).toHaveBeenCalledOnce();
   expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(1);
   expect(await balance(f.user)).toBe('0');
  }finally{methods.mockRestore();direct.mockRestore()}
 });
 it('keeps an uncertain one-statement preparation on its original key without starting Chapa',async()=>{
  const f=await fixture(),{session}=await creationBinding(f.user),headers=await signedHeaders(session.token);
  const interrupted=db.$extends({query:{$queryRaw:async({args,query})=>{await query(args);throw Error('Committed checkout reply lost')}}}) as unknown as PrismaClient;
  const methods=vi.spyOn(chapaTransport,'methods').mockImplementation(f.transport.methods);
  const direct=vi.spyOn(chapaTransport,'direct').mockImplementation(f.direct);
  try{
   await directMethodCatalog.get();
   await expect(tryCreateCurrentDirectCheckout(interrupted,headers,f.command)).rejects.toThrow('Committed checkout reply lost');
   expect(direct).not.toHaveBeenCalled();
   expect(await findCurrentDirectCheckoutByKey(db,f.user,f.command.key)).toMatchObject({status:'SUBMITTING'});
   expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(1);
  }finally{methods.mockRestore();direct.mockRestore()}
 });
 it.each(['TOP_UP','BID'] as const)('checks two prepared %s requests again under the existing locks and dispatches the original key once',async purpose=>{
  const f=await fixture(purpose),{authorize}=await creationBinding(f.user);
  const prepare=()=>prepareCurrentDirectCreation(db,f.user,f.command,f.transport,false);
  const [first,second]=await Promise.all([prepare(),prepare()]);
  expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
  expect(f.direct).not.toHaveBeenCalled();
  const [a,b]=await Promise.all([first(authorize),second(authorize)]);
  expect(a.order.id).toBe(b.order.id);
  expect(f.direct).toHaveBeenCalledOnce();
  await expect((await prepareCurrentDirectCreation(db,f.user,{...f.command,phone:'0912345678'},f.transport))(authorize)).rejects.toMatchObject({code:'KEY_REUSED'});
  expect(await balance(f.user)).toBe('0');
 });
 it.each(['TOP_UP','BID'] as const)('rejects a deleted session after the early %s read without dispatching or creating an intent',async purpose=>{
  const f=await fixture(purpose),{session,authorize}=await creationBinding(f.user);
  const start=await prepareCurrentDirectCreation(db,f.user,f.command,f.transport,false);
  await db.session.delete({where:{id:session.id}});
  await expect(start(authorize)).rejects.toMatchObject({status:401});
  expect(f.direct).not.toHaveBeenCalled();
  expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
 });
 it.each(['TOP_UP','BID'] as const)('commits eligible Direct %s under the restricted runtime role',async purpose=>{
  const f=await fixture(purpose),{authorize,binding}=await creationBinding(f.user);
  const {Client}=await import('pg'),sql=new Client({connectionString:database});await sql.connect();
  try{await sql.query(readFileSync('deploy/runtime-role.sql','utf8'))}finally{await sql.end()}
  const atomicTopUp=authorize.forCurrentDirectTopUp!,atomicBid=authorize.forCurrentDirectBid!;
  if(purpose==='TOP_UP')authorize.forCurrentDirectTopUp=(client,owner,input)=>client.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL ROLE lowwin_runtime`;
   return atomicTopUp(tx as unknown as PrismaClient,owner,input);
  });
  else authorize.forCurrentDirectBid=(client,owner,input)=>client.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL ROLE lowwin_runtime`;
   return atomicBid(tx as unknown as PrismaClient,owner,input);
  });
  const command=purpose==='TOP_UP'?{...f.command,amount:'5.00',approvedDepositBonusVersion:1,approvedDepositBonusAmount:'0.00'}:f.command;
  const prepare=await prepareCurrentDirectCreation(db,f.user,command,f.transport,false),{order}=await prepare(authorize);
  expect(authorize.forCurrentDirectCreate).not.toHaveBeenCalled();
  expect(purpose==='TOP_UP'?atomicTopUp:atomicBid).toHaveBeenCalledOnce();
  expect(order).toMatchObject({status:'AUTH_NEEDED',flowVersion:5,purpose,amount:purpose==='TOP_UP'?'5.00':'40.00'});
  const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  const amountCents=purpose==='TOP_UP'?'500':'4000';
  expect(f.direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({amountCents}),'create');
  expect(row.initialization).toMatchObject({flow:'DIRECT',amountCents,...(f.quote?{batch:{id:f.quote.id,lines:[{number:'2.00'},{number:'4.00'}]}}:{})});
  if(purpose==='TOP_UP')expect(row.initialization).not.toHaveProperty('depositBonus');
  expect(row.phoneBotId).toBe(binding.botId);
  for(const key of [`app:chapa-inline-create:${chapaHash(f.user)}`,`app:chapa-inline-initialize:${chapaHash(order.id)}`])expect((await db.rateLimit.findUniqueOrThrow({where:{key}})).count).toBe(1);
 });
 it.each(['TOP_UP','BID'] as const)('does not dispatch or fall back on an ambiguous %s preparation reply and recovers the same immutable original',async purpose=>{
  const f=await fixture(purpose),{authorize,binding}=await creationBinding(f.user);
  const interrupted=db.$extends({query:{$queryRaw:async({args,query})=>{await query(args);throw Error('Committed preparation reply lost')}}}) as unknown as PrismaClient;
  if(purpose==='TOP_UP')authorize.forCurrentDirectTopUp=(_,owner,input)=>prepareAtomicDirectTopUp(interrupted,binding,owner,input);
  else authorize.forCurrentDirectBid=(_,owner,input)=>prepareAtomicDirectBid(interrupted,binding,owner,input);
  const prepare=await prepareCurrentDirectCreation(db,f.user,f.command,f.transport,false);
  await expect(prepare(authorize)).rejects.toThrow('Committed preparation reply lost');
  expect(authorize.forCurrentDirectCreate).not.toHaveBeenCalled();expect(f.direct).not.toHaveBeenCalled();
  const original=await findCurrentDirectCheckoutByKey(db,f.user,f.command.key);
  expect(original.status).toBe('SUBMITTING');
  expect((await f.start()).order.id).toBe(original.id);expect(f.direct).not.toHaveBeenCalled();
  await db.chapaCheckout.update({where:{id:original.id},data:{leaseUntil:new Date(0)}});
  expect((await f.start()).order).toMatchObject({id:original.id,status:'AUTH_NEEDED'});
  expect(f.direct).toHaveBeenCalledOnce();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(1);
 });
 it('stops a stale zero-bonus approval before dispatch and records the accepted offer on the canonical path',async()=>{
  const f=await fixture(),{authorize}=await creationBinding(f.user);
  const prior=await db.depositBonusPolicy.findUnique({where:{id:'default'}});
  const policy={enabled:true,minCents:500n,percent:10,version:7};
  await db.depositBonusPolicy.upsert({where:{id:'default'},create:policy,update:policy});
  try{
   const start=async(amount:string,version:number)=>(await prepareCurrentDirectCreation(db,f.user,{...f.command,approvedDepositBonusVersion:version,approvedDepositBonusAmount:amount},f.transport,false))(authorize);
   await expect(start('0.00',1)).rejects.toMatchObject({code:'DEPOSIT_BONUS_CHANGED'});
   expect(authorize.forCurrentDirectTopUp).toHaveBeenCalledOnce();
   expect(f.direct).not.toHaveBeenCalled();
   expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
   const {order}=await start('4.00',7);
   expect(f.direct).toHaveBeenCalledOnce();
   const saved=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
   expect(saved.initialization).toMatchObject({depositBonus:{amountCents:'400',policyVersion:7}});
  }finally{
   if(prior)await db.depositBonusPolicy.update({where:{id:'default'},data:prior});
   else await db.depositBonusPolicy.update({where:{id:'default'},data:{enabled:false,version:1}});
  }
 });
 it('rejects a historical coupon quote before creating or dispatching a new payment',async()=>{
  const f=await fixture('BID'),{authorize}=await creationBinding(f.user),{coupon}=await earnedReferralCoupon(db,f.user);
  const quote=await seedLegacyCouponQuote(db,f.user,{key:randomUUID(),auctionSlug:f.auction!.slug!,numbers:['2','4'],feeVersion:1,couponId:coupon.id});
  const prepare=await prepareCurrentDirectCreation(db,f.user,{...f.command,batchId:quote.id,quoteHash:quote.quoteHash},f.transport,false);
  await expect(prepare(authorize)).rejects.toMatchObject({code:'COUPON_UNAVAILABLE'});
  expect(authorize.forCurrentDirectCreate).toHaveBeenCalledOnce();expect(f.direct).not.toHaveBeenCalled();
  expect(await db.chapaCheckout.count({where:{batchId:quote.id}})).toBe(0);
  expect(await db.referralRedemption.count({where:{couponId:coupon.id}})).toBe(0);
 });
 it('cannot use a foreign quote and retains authoritative fee and method limits',async()=>{
  const f=await fixture('BID'),other=(await verifiedReferralUser(db)).id,foreign=await creationBinding(other),own=await creationBinding(f.user);
  const attempt=async(userId:string,authorize:PaymentSessionAuthorizer)=>(await prepareCurrentDirectCreation(db,userId,f.command,f.transport,false))(authorize);
  await expect(attempt(other,foreign.authorize)).rejects.toMatchObject({code:'TERMS_CHANGED'});
  f.transport.methods=vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:5000,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]}));
  await expect(attempt(f.user,own.authorize)).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});
  await db.auctionFeeRevision.create({data:{auctionId:f.auction!.id,version:2,feePoints:24,reason:'Isolated Direct fee revision'}});
  await expect(attempt(f.user,own.authorize)).rejects.toMatchObject({code:'TERMS_CHANGED'});
  expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{batchId:f.quote!.id}})).toBe(0);
  expect(await db.rateLimit.count({where:{key:`app:chapa-inline-create:${chapaHash(f.user)}`}})).toBe(0);
 });
 it('prepares a coupon-free quote without waiting for the wallet writer',async()=>{
  const {id:userId}=await verifiedReferralUser(db),auction=await realReferralAuction(db,20);
  let held!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>{held=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
  const writer=db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;held();await gate});
  await ready;
  const quoted=quoteBidBatch(db,userId,{key:randomUUID(),auctionSlug:auction.slug!,numbers:['2','4'],feeVersion:1});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Coupon-free quote waited for the wallet writer')),2500)});
   await expect(Promise.race([quoted,timeout])).resolves.toMatchObject({total:'40.00',status:'QUOTED'});
   expect(await db.bid.count({where:{userId}})).toBe(0);
   expect(await balance(userId)).toBe('0');
  }finally{clearTimeout(timer);release();await Promise.allSettled([quoted,writer])}
 });
 it('preloads only an owned status and still requires private proof after the fresh verification lease',async()=>{
  const f=await fixture(),{order}=await f.start(),other=await verifiedReferralUser(db);
  await f.due();f.setStatus('SUCCESS');f.setValidation('SUCCESS');
  await expect(prepareOwnedChapaVerification(db,order.id,other.id,f.transport)).rejects.toMatchObject({code:'NOT_FOUND'});
  const verify=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport);
  expect(f.lookup).not.toHaveBeenCalled();
  const reauthorize=vi.fn(async()=>{});
  expect(await verify(reauthorize)).toMatchObject({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});
  expect(reauthorize).toHaveBeenCalled();
  expect(await balance(f.user)).toBe('40');
  expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
 });
 it.each(['TOP_UP','BID'] as const)('checks and persists a cancelled Direct %s using the signed session in both writes',async purpose=>{
  const f=await fixture(purpose),{order}=await f.start();
  f.setStatus('CANCELLED');
  const check=await ownedVerification(f,order.id);
  expect(await check.verify()).toMatchObject({status:'CANCELLED',verificationState:'VERIFIED'});
  expect(check.transactionAuthorization).not.toHaveBeenCalled();
  expect(f.lookup).toHaveBeenCalledOnce();expect(f.validate).not.toHaveBeenCalled();
  expect(await balance(f.user)).toBe('0');
  expect(await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).toMatchObject({leaseUntil:null,creditJournalId:null});
 });
 it('uses fenced statements for a routine background Direct check and preserves atomic credit on success',async()=>{
  const f=await fixture(),{order}=await f.start(),operations:string[]=[];
  const client=db.$extends({query:{
   $queryRaw:async({args,query})=>{operations.push('$queryRaw');return query(args)},
   $allModels:{$allOperations:async({operation,args,query})=>{operations.push(operation);return query(args)}},
  }}) as unknown as PrismaClient;
  const check=()=>verifyChapaCheckout(client,order.id,undefined,undefined,f.transport);
  await expect(check()).resolves.toMatchObject({status:'PENDING',verificationState:'VERIFIED'});
  expect(operations).toEqual(['findFirst','updateManyAndReturn','updateManyAndReturn']);
  expect(await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).toMatchObject({leaseUntil:null,creditJournalId:null});
  expect(await balance(f.user)).toBe('0');

  f.setStatus('SUCCESS');f.setValidation('SUCCESS');await f.due();
  await expect(check()).resolves.toMatchObject({status:'CREDITED',verificationState:'VERIFIED'});
  await expect(check()).resolves.toMatchObject({status:'CREDITED'});
  expect(await balance(f.user)).toBe('40');
  expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
 });
 it('preserves a completion webhook racing a background Direct check',async()=>{
  const f=await fixture(),{order}=await f.start();
  f.lookup.mockImplementationOnce(async()=>{
   const pendingProof=f.proof();
   await verifyChapaCheckout(db,order.id,undefined,undefined,f.transport,'webhook',undefined,'SUCCESS');
   expect(await balance(f.user)).toBe('0');
   f.setStatus('SUCCESS');
   return pendingProof;
  });
  await expect(verifyChapaCheckout(db,order.id,undefined,undefined,f.transport)).resolves.toMatchObject({status:'CREDITED',completionSignalPending:false});
  expect(f.lookup).toHaveBeenCalledTimes(2);
  expect(await balance(f.user)).toBe('40');
  expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
 });
 it.each(['before claim','before commit'] as const)('rejects a signed session revoked %s',async when=>{
  const f=await fixture(),{order}=await f.start(),check=await ownedVerification(f,order.id);
  f.setStatus('CANCELLED');
  const revoke=()=>db.session.delete({where:{id:check.session.id}});
  if(when==='before claim')await revoke();
  else f.lookup.mockImplementationOnce(async()=>{await revoke();return f.proof()});
  await expect(check.verify()).rejects.toMatchObject({status:401});
  expect(f.lookup).toHaveBeenCalledTimes(when==='before claim'?0:1);
  expect(await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).toMatchObject({status:'AUTH_NEEDED',creditJournalId:null});
 });
 it('brings an owned USSD check forward once on wallet return and waits for private proof',async()=>{
  const f=await fixture('BID'),{order}=await f.start(),reauthorize=vi.fn(async()=>{});
  await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(Date.now()+30_000)}});
  const check=async(walletReturn:boolean)=>(await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,walletReturn))(reauthorize);
  await expect(check(false)).resolves.toMatchObject({status:'AUTH_NEEDED'});
  expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).not.toHaveBeenCalled();
  await Promise.all([check(true),check(true)]);
  await check(true);
  expect(f.validate).toHaveBeenCalledOnce();expect(f.lookup).toHaveBeenCalledOnce();
  expect(f.lookup.mock.invocationCallOrder[0]).toBeLessThan(f.validate.mock.invocationCallOrder[0]);
  expect(await db.bid.count({where:{userId:f.user}})).toBe(0);
  const saved=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(saved.attempts).toBe(2);expect(saved.leaseUntil).toBeNull();
  f.setStatus('SUCCESS');f.setValidation('SUCCESS');await f.due();
  await expect(check(false)).resolves.toMatchObject({status:'BID_ACCEPTED',verificationState:'VERIFIED'});
  expect(await db.bid.count({where:{userId:f.user}})).toBe(2);
 });
 it.each(['SUCCESS','CANCELLED'] as const)('finds private Telebirr %s on the first short poll without a wallet event',async(status)=>{
  const f=await fixture('BID'),{order}=await f.start();
  await expect(f.verify()).resolves.toMatchObject({status:'PENDING',pollAfterMs:2000});
  const waiting=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(waiting.nextCheckAt.getTime()-waiting.lastPrivateCheckAt!.getTime()).toBe(2000);
  // Simulate provider completion by the scheduled follow-up, without firing a
  // visibility event or using a terminal response from Validate Direct Charge.
  f.setStatus(status);
  await expect(f.verify()).resolves.toMatchObject({status:status==='SUCCESS'?'BID_ACCEPTED':status,providerStatus:status,verificationState:'VERIFIED'});
  expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.validate).toHaveBeenCalledOnce();
  expect(await db.bid.count({where:{userId:f.user}})).toBe(status==='SUCCESS'?2:0);
  expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(status==='SUCCESS'?1:0);
 });
 it('limits ordinary Telebirr verification to two early intervals and honors longer due times',async()=>{
  const f=await fixture(),{order}=await f.start();
  for(const expected of [2000,2000,5000]){
   await expect(f.verify()).resolves.toMatchObject({status:'PENDING'});
   const waiting=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
   if(expected===2000)expect(waiting.nextCheckAt.getTime()-waiting.lastPrivateCheckAt!.getTime()).toBe(2000);
   else expect(waiting.nextCheckAt.getTime()-waiting.updatedAt.getTime()).toBeGreaterThanOrEqual(4750);
  }
  expect(f.lookup).toHaveBeenCalledTimes(3);
  await expect(verifyChapaCheckout(db,order.id,f.user,undefined,f.transport)).resolves.toMatchObject({status:'PENDING'});
  expect(f.validate).toHaveBeenCalledTimes(3);expect(f.lookup).toHaveBeenCalledTimes(3);
  await expect(f.verify()).resolves.toMatchObject({status:'PENDING'});
  expect(f.validate).toHaveBeenCalledTimes(4);expect(f.lookup).toHaveBeenCalledTimes(3);
 });
 it.each(['PENDING','SUCCESS'] as const)('checks private %s on one short ordinary retry after a later owned Telebirr wallet return',async(status)=>{
  const f=await fixture(),{order}=await f.start();
  await db.chapaCheckout.update({where:{id:order.id},data:{attempts:10,nextCheckAt:new Date(Date.now()+30000)}});
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(async()=>{})).resolves.toMatchObject({status:'PENDING',verificationState:'VERIFIED',pollAfterMs:2000});
  const waiting=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  expect(waiting.nextCheckAt.getTime()-waiting.lastPrivateCheckAt!.getTime()).toBe(2000);
  f.setStatus(status);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,waiting.nextCheckAt.getTime()-Date.now()+10)));
  // The normal POST does not carry another wallet-return hint, and the
  // provider's authorization endpoint still says PENDING.
  const verify=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport);
  await expect(verify(async()=>{})).resolves.toMatchObject({status:status==='SUCCESS'?'CREDITED':status,providerStatus:status});
  expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.validate).toHaveBeenCalledTimes(status==='SUCCESS'?1:2);
  const next=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});
  if(status==='PENDING')expect(next.nextCheckAt.getTime()-next.updatedAt.getTime()).toBeGreaterThanOrEqual(4750);
  expect(await balance(f.user)).toBe(status==='SUCCESS'?'40':'0');
 });
 it.each(['PENDING','CANCELLED'] as const)('commits private Direct5 %s while a separate writer holds the auction and wallet locks',async(status)=>{
  const f=await fixture('BID'),{order}=await f.start();f.setStatus(status);
  let acquired!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>{acquired=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
  const writer=db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0))`;
   await tx.$executeRaw`SELECT id FROM "Auction" WHERE id=${f.auction!.id} FOR UPDATE`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${f.user}`},0))`;
   acquired();await gate;
  },{timeout:10000,maxWait:5000});
  let verification:Promise<unknown>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await ready;
   const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
   verification=returned(async()=>{});
   const limit=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Checkout status waited for a financial lock.')),3000)});
   await expect(Promise.race([verification,limit])).resolves.toMatchObject({status,providerStatus:status,verificationState:'VERIFIED'});
   expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(0);
  }finally{clearTimeout(timer);release();await Promise.allSettled([writer,verification])}
 });
 it.each([true,false])('settles a privately completed auction wallet return without validation (poll due: %s)',async(due)=>{
  const f=await fixture('BID'),{order}=await f.start();
  await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:new Date(Date.now()+(due?-1:30_000))}});
  f.setStatus('SUCCESS');
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(vi.fn(async()=>{}))).resolves.toMatchObject({status:'BID_ACCEPTED',verificationState:'VERIFIED'});
  expect(f.lookup).toHaveBeenCalledOnce();expect(f.validate).not.toHaveBeenCalled();
  expect(await db.bid.count({where:{userId:f.user}})).toBe(2);
  expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
 });
 it('records a privately cancelled wallet return without running another authorization',async()=>{
  const f=await fixture(),{order}=await f.start();f.setStatus('CANCELLED');
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(async()=>{})).resolves.toMatchObject({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED'});
  expect(f.lookup).toHaveBeenCalledOnce();expect(f.validate).not.toHaveBeenCalled();
  expect(await balance(f.user)).toBe('0');
 });
 it('looks up fresh private evidence when a pending wallet return refresh detects completion',async()=>{
  const f=await fixture(),{order}=await f.start();
  f.setValidation('SUCCESS');
  f.lookup.mockImplementationOnce(async()=>{const pendingProof=f.proof();f.setStatus('SUCCESS');return pendingProof});
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(async()=>{})).resolves.toMatchObject({status:'CREDITED',providerStatus:'SUCCESS'});
  expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.validate).toHaveBeenCalledOnce();
  expect(f.lookup.mock.invocationCallOrder[0]).toBeLessThan(f.validate.mock.invocationCallOrder[0]);
  expect(f.validate.mock.invocationCallOrder[0]).toBeLessThan(f.lookup.mock.invocationCallOrder[1]);
 });
 it('retains authorization refresh when the initial merchant lookup has no reference yet',async()=>{
  const f=await fixture(),{order}=await f.start();f.setStatus('SUCCESS');
  f.lookup.mockRejectedValueOnce(new ChapaProviderError(404,'PAYMENT_NOT_FOUND'));
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(async()=>{})).resolves.toMatchObject({status:'CREDITED',providerStatus:'SUCCESS'});
  expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.validate).toHaveBeenCalledOnce();
 });
 it('keeps provider rate limiting on a private-first wallet return',async()=>{
  const f=await fixture(),{order}=await f.start();
  f.lookup.mockRejectedValueOnce(new ChapaProviderError(429,'RATE_LIMITED'));
  const returned=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(returned(async()=>{})).resolves.toMatchObject({verificationUnavailable:true});
  const retry=await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true);
  await expect(retry(async()=>{})).resolves.toMatchObject({verificationState:'UNAVAILABLE'});
  expect(f.lookup).toHaveBeenCalledOnce();expect(f.validate).not.toHaveBeenCalled();
  expect(await balance(f.user)).toBe('0');
 });
 it('keeps the existing provider deadline, lease and fresh session checks on return',async()=>{
  const f=await fixture(),{order}=await f.start(),reauthorize=vi.fn(async()=>{}),future=new Date(Date.now()+30_000);
  const check=async()=>(await prepareOwnedChapaVerification(db,order.id,f.user,f.transport,true))(reauthorize);
  await db.chapaCheckout.update({where:{id:order.id},data:{nextCheckAt:future,verificationRetryAfter:future}});
  await check();
  await db.chapaCheckout.update({where:{id:order.id},data:{verificationRetryAfter:null,leaseUntil:future}});
  await check();
  expect(reauthorize).not.toHaveBeenCalled();expect(f.lookup).not.toHaveBeenCalled();
  await db.chapaCheckout.update({where:{id:order.id},data:{leaseUntil:null}});
  reauthorize.mockRejectedValueOnce(Object.assign(Error('Session revoked'),{status:401}));
  await expect(check()).rejects.toMatchObject({status:401});
  expect(f.lookup).not.toHaveBeenCalled();expect(f.validate).not.toHaveBeenCalled();
  expect(await balance(f.user)).toBe('0');
 });
 it('commits a distinct immutable Direct5 intent before dispatch without any public key or hosted call',async()=>{
  const f=await fixture(),{order}=await f.start();expect(order).toMatchObject({flowVersion:5,chargeType:'DIRECT',apiVersion:'v2',status:'AUTH_NEEDED',authType:'USSD',amount:'40.00'});
  const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});expect(row.initialization).toMatchObject({apiVersion:'v2',flowVersion:5,flow:'DIRECT',metadata:{checkout_id:row.id},idempotencyKey:`lowwin-direct-v5:${row.id}`,webhookSignatureProfile:'raw_body'});expect(row.initialization).not.toHaveProperty('publicKeyFingerprint');expect(await balance(f.user)).toBe('0');expect(f.lookup).not.toHaveBeenCalled();
 });
 it.each(['FAILED','SUCCESS'])('retains accepted empty-auth USSD authorization on one unpaid intent until private %s evidence',async status=>{
  const f=await fixture();f.setAuth('');f.setInitializationStatus('Accepted');
  const {order}=await f.start();expect(order).toMatchObject({status:'AUTH_NEEDED',authType:'USSD',verificationState:'UNVERIFIED',providerStatus:null,reason:null});
  const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:f.id()}});expect(row.authorizationReference).toBe(f.proof().data.chapa_reference);expect(row.providerRequestId).toMatch(/^req_/);expect(await balance(f.user)).toBe('0');expect(f.lookup).not.toHaveBeenCalled();
  expect((await f.start()).order.id).toBe(order.id);expect(f.direct).toHaveBeenCalledOnce();
  expect(await f.verify()).toMatchObject({providerStatus:'PENDING',verificationState:'VERIFIED'});expect(await balance(f.user)).toBe('0');
  f.setStatus(status);f.setValidation(status);expect(await f.verify()).toMatchObject({status:status==='SUCCESS'?'CREDITED':'FAILED',providerStatus:status,verificationState:'VERIFIED'});
  await f.verify();expect(await balance(f.user)).toBe(status==='SUCCESS'?'40':'0');expect(f.direct).toHaveBeenCalledOnce();expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(status==='SUCCESS'?1:0);
 });
 it('keeps the saved future observation window for the exact accepted nanosecond-expiry envelope',async()=>{
  const f=await fixture();f.setAuth('');f.setInitializationStatus('Accepted');f.setInitializationDates({created_at:'2026-11-17T18:56:30.326927837Z',expires_at:'2026-11-17T18:56:30.326927992Z'});
  const before=Date.now(),{order}=await f.start();expect(order).toMatchObject({status:'AUTH_NEEDED',authType:'USSD',verificationState:'UNVERIFIED'});
  const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});expect(row.providerCreatedAt).toEqual(new Date('2026-11-17T18:56:30.326Z'));expect(row.expiresAt.getTime()).toBeGreaterThan(before+240000);
  expect(chapaPollingDeadline({createdAt:order.createdAt,expiresAt:order.expiresAt,apiVersion:'v2',flowVersion:5,chargeType:'DIRECT'})).toBeGreaterThan(before+240000);
  expect(await verifyChapaCheckout(db,f.id(),f.user,undefined,f.transport)).toMatchObject({providerStatus:'PENDING',verificationState:'VERIFIED'});expect(f.lookup).toHaveBeenCalledOnce();expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');
 });
 it('retains one provider operation across concurrent duplicate commands and protocol-specific owned-key discovery',async()=>{
  const f=await fixture(),[one,two]=await Promise.all([f.start(),f.start()]);expect(one.order.id).toBe(two.order.id);expect(f.direct).toHaveBeenCalledOnce();expect(await findCurrentDirectCheckoutByKey(db,f.user,f.command.key)).toMatchObject({id:one.order.id});
  await expect(findInlineCheckoutByKey(db,f.user,f.command.key)).rejects.toMatchObject({status:404});await expect(findCurrentDirectCheckoutByKey(db,(await verifiedReferralUser(db)).id,f.command.key)).rejects.toMatchObject({status:404});
 });
 it('rejects methods lacking Direct capability before persisting or dispatching a charge',async()=>{const f=await fixture();f.setCapable(false);await expect(f.start()).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0)});
 it.each(['TOP_UP','BID'] as const)('reads a newly committed maintenance halt before the %s dispatch',async purpose=>{
  const f=await fixture(purpose),{authorize}=await creationBinding(f.user),prepare=await prepareCurrentDirectCreation(db,f.user,f.command,f.transport,false);let acquired!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>{acquired=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
  const writer=db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0))`;
   await tx.adminAudit.create({data:{actorId:'isolated-direct-maintainer',action:'AUCTIONS_MAINTENANCE_HALTED',target:'direct-barrier-regression',details:{runId:'direct-barrier-regression'}}});acquired();await gate;
  },{timeout:10000,maxWait:5000});
  await ready;const outcome=prepare(authorize).then(value=>value,error=>error);
  try{
   await vi.waitFor(async()=>{const [row]=await db.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting`;expect(row.waiting).toBe(true)},{timeout:3000,interval:25});
   expect(f.direct).not.toHaveBeenCalled();release();await writer;expect(await outcome).toMatchObject({code:'AUCTIONS_PAUSED'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0);
  }finally{
   release();await writer.catch(()=>{});await outcome;
   await db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lowwin:auction-maintenance',0))`;await tx.adminAudit.create({data:{actorId:'isolated-direct-maintainer',action:'AUCTIONS_MAINTENANCE_RESUMED',target:'direct-barrier-regression',details:{runId:'direct-barrier-regression'}}})});
  }
 });
 it.each(['TOP_UP','BID'] as const)('commits both original %s budgets once and rolls them back together when creation is exhausted',async purpose=>{
  const f=await fixture(purpose),{authorize}=await creationBinding(f.user);await createCurrentDirectCheckout(db,f.user,f.command,authorize,f.transport);
  const creation=`app:chapa-inline-create:${chapaHash(f.user)}`,initialization=`app:chapa-inline-initialize:${chapaHash(f.id())}`;
  expect((await db.rateLimit.findUniqueOrThrow({where:{key:creation}})).count).toBe(1);expect((await db.rateLimit.findUniqueOrThrow({where:{key:initialization}})).count).toBe(1);
  await f.start();expect((await db.rateLimit.findUniqueOrThrow({where:{key:initialization}})).count).toBe(1);expect(f.direct).toHaveBeenCalledOnce();
  const exhausted=await fixture(purpose),bound=await creationBinding(exhausted.user);for(let index=0;index<24;index++)expect(await allowIdentityRequest(db,'chapa-inline-create',exhausted.user,24,3600000)).toBe(true);
  const before=await db.rateLimit.count({where:{key:{startsWith:'app:chapa-inline-initialize:'}}});await expect(createCurrentDirectCheckout(db,exhausted.user,exhausted.command,bound.authorize,exhausted.transport)).rejects.toMatchObject({code:'RATE_LIMITED'});
  expect(await db.chapaCheckout.count({where:{userId:exhausted.user}})).toBe(0);expect(exhausted.direct).not.toHaveBeenCalled();expect((await db.rateLimit.findUniqueOrThrow({where:{key:`app:chapa-inline-create:${chapaHash(exhausted.user)}`}})).count).toBe(24);expect(await db.rateLimit.count({where:{key:{startsWith:'app:chapa-inline-initialize:'}}})).toBe(before);
 });
 it('successful USSD validation immediately verifies privately and credits despite a recent pending private lookup',async()=>{
  const f=await fixture();await f.start();await f.verify();expect(f.lookup).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');
  await db.chapaCheckout.update({where:{id:f.id()},data:{attempts:5}});
  f.validate.mockClear();f.setValidation('SUCCESS');f.setStatus('SUCCESS');
  const result=await f.verify();expect(result).toMatchObject({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',completionSignalPending:false});expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('40');await f.verify();expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
  expect(f.validate).toHaveBeenCalledOnce();
 });
 it.each<ChapaCompletionStatus>(['SUCCESS','FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED','FAILED_OR_CANCELLED'])('privately rechecks a retained %s signal without redundant USSD validation or trusting the signal as payment',async completion=>{
  const f=await fixture();await f.start();
  // The authenticated-event path records a bound hint, but its first private
  // lookup can still be pending. The next ordinary observer must check that
  // original payment directly instead of refreshing the phone authorization.
  expect(await verifyChapaCheckout(db,f.id(),f.user,undefined,f.transport,'webhook',undefined,completion)).toMatchObject({providerStatus:'PENDING',completionSignalPending:true});
  expect(f.validate).not.toHaveBeenCalled();f.lookup.mockClear();
  expect(await f.verify()).toMatchObject({providerStatus:'PENDING',verificationState:'VERIFIED',completionSignalPending:true});
  expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(0);
 });
 it('fulfills a retained completion signal only after private success and credits the original operation once',async()=>{
  const f=await fixture();await f.start();await verifyChapaCheckout(db,f.id(),f.user,undefined,f.transport,'webhook',undefined,'SUCCESS');
  f.lookup.mockClear();f.setStatus('SUCCESS');
  expect(await f.verify()).toMatchObject({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',completionSignalPending:false});
  expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledOnce();expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('40');
  await f.verify();expect(f.lookup).toHaveBeenCalledOnce();expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps rejected OTP on the same attempt and requires private success after a corrected code',async()=>{
  const f=await fixture();f.setAuth('OTP');await f.start();f.validate.mockRejectedValueOnce(new ChapaProviderError(400,'INVALID_OTP',undefined,'INVALID_OTP'));
  await authorizeDirectCheckout(db,f.user,f.id(),{otp:'123456'},undefined,f.transport);expect(await balance(f.user)).toBe('0');f.setValidation('SUCCESS');f.setStatus('SUCCESS');
  expect(await authorizeDirectCheckout(db,f.user,f.id(),{otp:'654321'},undefined,f.transport)).toMatchObject({status:'CREDITED'});expect(f.validate).toHaveBeenCalledTimes(2);expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('40');
 });
 it('private success atomically accepts the complete batch once under concurrent checks',async()=>{
  const f=await fixture('BID');await f.start();f.setStatus('SUCCESS');f.setValidation('SUCCESS');await f.due();await Promise.all([verifyChapaCheckout(db,f.id(),f.user,undefined,f.transport),verifyChapaCheckout(db,f.id(),f.user,undefined,f.transport)]);
  expect(await db.bid.count({where:{userId:f.user}})).toBe(2);expect(await balance(f.user)).toBe('0');expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('late confirmed auction money becomes one wallet credit without a late bid or another refund',async()=>{
  const f=await fixture('BID',3500);await f.start();await new Promise(resolve=>setTimeout(resolve,Math.max(0,f.auction!.endsAt!.getTime()-Date.now()+30)));f.setStatus('SUCCESS');f.setValidation('SUCCESS');expect(await f.verify()).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true});await f.verify();expect(await balance(f.user)).toBe('40');expect(await db.bid.count({where:{userId:f.user}})).toBe(0);expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);expect(await db.auctionRefund.count({where:{userId:f.user}})).toBe(0);
 });
 it('enforces Direct5 identity at insertion and accepted authorization immutability in the database',async()=>{
  const f=await fixture();await f.start();const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:f.id()}});
  for(const change of [{flowVersion:4},{flowVersion:null},{flow:'INLINE'},{amountCents:'4001'},{paymentMethod:'mpesa'},{paymentMethod:null},{payerPhoneHash:null},{metadata:{checkout_id:'other'}},{metadata:null},{webhookSignatureProfile:null},{webhookSignatureProfile:'unknown'}]){
   const id=randomUUID(),merchantReference='LW'+randomUUID().replaceAll('-','').slice(0,18),initialization={...(row.initialization as Record<string,unknown>),metadata:{checkout_id:id},merchantReference,idempotencyKey:`lowwin-direct-v5:${id}`,...change};
   await expect(db.chapaCheckout.create({data:{...row,id,key:randomUUID(),merchantReference,initialization:initialization as Prisma.InputJsonValue,receipt:Prisma.JsonNull}})).rejects.toThrow();
  }
  const nullId=randomUUID(),nullMerchant='LW'+randomUUID().replaceAll('-','').slice(0,18);
  await expect(db.chapaCheckout.create({data:{...row,id:nullId,key:randomUUID(),merchantReference:nullMerchant,paymentMethod:null,initialization:{...(row.initialization as Record<string,unknown>),metadata:{checkout_id:nullId},merchantReference:nullMerchant,idempotencyKey:`lowwin-direct-v5:${nullId}`,paymentMethod:null} as Prisma.InputJsonValue,receipt:Prisma.JsonNull}})).rejects.toThrow();
  for(const change of [{paymentMethod:'mpesa'},{authorizationReference:'CH-other'},{authType:'OTP'},{providerRequestId:'req_other'}])await expect(db.chapaCheckout.update({where:{id:row.id},data:change})).rejects.toThrow('immutable');
 });
 it('Direct5 top-up freezes and credits the approved bonus once without converting bonus into cash',async()=>{
  await db.depositBonusPolicy.upsert({where:{id:'default'},create:{id:'default',enabled:true,percent:10,minCents:100n,validityDays:7,version:1,updatedAt:new Date()},update:{enabled:true,percent:10,minCents:100n,validityDays:7,endsAt:null}});
  try{const f=await fixture();await f.start({approvedDepositBonusVersion:1,approvedDepositBonusAmount:'4.00'});f.setStatus('SUCCESS');f.setValidation('SUCCESS');await f.verify();await f.verify();expect(await balance(f.user)).toBe('40');expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.user}:bonus`}})).balance.toString()).toBe('4');expect(await db.depositBonusLot.count({where:{userId:f.user}})).toBe(1);expect(await reconcile(db)).toEqual([]);}finally{await db.depositBonusPolicy.update({where:{id:'default'},data:{enabled:false}})}
 });
});
