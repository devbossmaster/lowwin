import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifiedReferralUser,realReferralAuction,earnedReferralCoupon} from './referral-fixtures';
import {creditDevelopmentPoints,ensureWallet,reconcile,seedPlatformAccounts} from '../src/modules/wallet/ledger';
import {reconcileChapaReceipts} from '../src/modules/payments/chapa-reconcile';
import {submitBid,submitBidInTransaction} from '../src/modules/auctions/bids';
import {createChapaCheckout,getChapaCheckout,listChapaCheckouts,verifyChapaCheckout} from '../src/modules/payments/chapa';
import {chapaAvailability,type ChapaCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {TEST_TOKEN} from './helpers';

const database=process.env.CHAPA_TEST_DATABASE_URL;
const gateway={CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+ 'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'local-chapa-signature-secret-thirty-two-characters',CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowin.ngrok-free.app',MINI_APP_URL:'https://lowin.ngrok-free.app',CHAPA_BASE_URL:'https://api.chapa.global',CHAPA_CURRENCY:'ETB',PAYMENTS_LIVE_ENABLED:'false',CHAPA_LIVE_ENABLED:'false'};
describe.skipIf(!database)('Chapa v2 hosted payments on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const u=new URL(database!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Explicit disposable loopback Chapa _test database required');
  Object.assign(process.env,{...gateway,DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-chapa-contact-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'chapa-test',PHONE_CONTACT_KEYS:JSON.stringify({'chapa-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});
  await db.referralPolicy.create({data:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'isolated-chapa-owner'}});
  expect(chapaAvailability()).toMatchObject({enabled:true,recoveryEnabled:true,mode:'test'});
 },60000);
 afterEach(()=>Object.assign(process.env,gateway));
 afterAll(async()=>{await db?.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()});
 const balance=async(userId:string)=>(await db.ledgerAccount.findUnique({where:{name:`user:${userId}:available`}}))?.balance.toString()??'0';
 const due=async(id:string)=>{await db.chapaCheckout.update({where:{id},data:{nextCheckAt:new Date(0),leaseUntil:null}})};
 async function payment(options:{purpose?:'TOP_UP'|'BID';amount?:string;fee?:number;endDelayMs?:number;userId?:string;couponId?:string;initialBalance?:string}={}){
  const userId=options.userId??(await verifiedReferralUser(db,'Synthetic Chapa customer')).id;
  if(options.initialBalance)await creditDevelopmentPoints(db,userId,options.initialBalance,`chapa-test-${randomUUID()}`);
  const auction=options.purpose==='BID'?await realReferralAuction(db,options.fee??30,options.endDelayMs??3600000):null;
  const key=randomUUID(),reference='CH'+randomUUID().replaceAll('-',''),inputs:ChapaCreate[]=[];let created:ChapaCreate|undefined,status='SUCCESS',failInitialization=false,mutate:(row:Record<string,unknown>)=>Record<string,unknown>=row=>row;
  const create=vi.fn(async(input:ChapaCreate)=>{created=structuredClone(input);inputs.push(created);if(failInitialization){failInitialization=false;throw Error('Ambiguous network timeout after provider received request')}return {status:'success',data:{checkout_url:`https://checkout.chapa.global/${reference}`,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}}});
  const lookup=vi.fn(async(paymentReference:string)=>({status:'success',data:mutate({chapa_reference:reference,merchant_reference:created!.merchantReference,amount:Number(created!.amountCents),currency:'ETB',status,payment_method:'telebirr',processor_reference:'SYNTHETIC-'+reference,service_fee:30,mode:'test',meta:created!.meta,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})}));
  const methods=vi.fn(async()=>({status:'success',data:[]})),transport:ChapaTransport={create,lookup,methods};
  const input=auction?{key,purpose:'BID' as const,auctionSlug:auction.slug!,amount:options.amount??'3.60',feeVersion:1,...(options.couponId?{couponId:options.couponId}:{})}:{key,purpose:'TOP_UP' as const,amount:options.amount??'10.00'};
  const start=()=>createChapaCheckout(db,userId,input,undefined,transport),verify=async(id:string)=>{await due(id);return verifyChapaCheckout(db,id,userId,undefined,transport)};
  return {userId,auction,key,input,start,verify,transport,create,lookup,methods,inputs,reference,setStatus:(value:string)=>{status=value},setMutation:(fn:typeof mutate)=>{mutate=fn},failNextInitialization:()=>{failInitialization=true}};
 }
 it('persists a private top-up attempt without treating initialization as payment',async()=>{
  const f=await payment({amount:'25.50'}),order=await f.start();expect(order).toMatchObject({purpose:'TOP_UP',mode:'test',amount:'25.50',amountCents:'2550',status:'PENDING'});expect(await balance(f.userId)).toBe('0');expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(0);expect(f.methods).not.toHaveBeenCalled();
  expect(f.inputs[0]).toMatchObject({amountCents:'2550',idempotencyKey:`lowwin:${order.id}`,returnUrl:`${gateway.MINI_APP_URL}/payments/chapa/return?checkout=${order.id}`});expect(f.inputs[0].merchantReference.length).toBeLessThanOrEqual(20);expect(order).not.toHaveProperty('initialization');expect(order).not.toHaveProperty('phoneCipher');expect(order).not.toHaveProperty('credentialFingerprint');
 });
 it('does not confuse operation success with successful payment or credit unsuccessful states',async()=>{
  for(const status of ['PENDING','AUTH_NEEDED','FAILED','CANCELLED','INCOMPLETE','BLOCKED']){const f=await payment(),order=await f.start();f.setStatus(status);const result=await f.verify(order.id);expect(result.status).toBe(status==='INCOMPLETE'?'EXPIRED':status==='BLOCKED'?'FAILED':status);expect(await balance(f.userId)).toBe('0');expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(0)}
 });
 it('credits exact verified cents once with one balanced journal and one private alert',async()=>{
  const f=await payment({amount:'25.50',initialBalance:'7'}),order=await f.start();await due(order.id);await Promise.all([verifyChapaCheckout(db,order.id,f.userId,undefined,f.transport),verifyChapaCheckout(db,order.id,f.userId,undefined,f.transport)]);
  expect((await getChapaCheckout(db,f.userId,order.id)).status).toBe('CREDITED');expect(await balance(f.userId)).toBe('32.5');expect(f.lookup).toHaveBeenCalledTimes(1);await f.verify(order.id);expect(f.lookup).toHaveBeenCalledTimes(1);
  const operations=await db.operation.findMany({where:{userId:f.userId,scope:'CHAPA_RECEIPT'},include:{journal:{include:{postings:true}}}});expect(operations).toHaveLength(1);expect(operations[0].journal?.postings.map(p=>p.delta.toString()).sort()).toEqual(['-25.5','25.5']);expect(await db.notificationInbox.count({where:{key:`chapa:${order.id}:credited`}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('requires exact amount, currency, merchant/reference, mode and supplied attempt metadata',async()=>{
  for(const change of [{amount:999},{currency:'USD'},{merchant_reference:'wrong-reference'},{chapa_reference:'CHwrong'},{mode:'live'},{meta:{lowwin_attempt:randomUUID()}}]){const f=await payment(),order=await f.start();f.setMutation(row=>({...row,...change}));expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'EVIDENCE_MISMATCH',fundsPreserved:false});expect(await balance(f.userId)).toBe('0');expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(0)}expect(await reconcile(db)).toEqual([]);
 });
 it('enforces owned reads and verification and avoids querying an unconfigured history table',async()=>{
  const f=await payment(),order=await f.start(),other=(await verifiedReferralUser(db)).id;await expect(getChapaCheckout(db,other,order.id)).rejects.toMatchObject({status:404,code:'NOT_FOUND'});await expect(verifyChapaCheckout(db,order.id,other,undefined,f.transport)).rejects.toMatchObject({status:404,code:'NOT_FOUND'});expect((await listChapaCheckouts(db,f.userId)).items.map(r=>r.id)).toEqual([order.id]);expect((await listChapaCheckouts(db,other)).items).toEqual([]);process.env.CHAPA_SCHEMA_READY='false';expect(await listChapaCheckouts(db,f.userId)).toEqual({items:[]});expect(f.lookup).not.toHaveBeenCalled();
 });
 it('deduplicates concurrent and refreshed keys for an unresolved top-up or bid intent',async()=>{
  for(const purpose of ['TOP_UP','BID'] as const){const f=await payment({purpose}),orders=await Promise.all([f.start(),f.start()]);expect(orders[0].id).toBe(orders[1].id);expect(f.create).toHaveBeenCalledTimes(1);const again=await createChapaCheckout(db,f.userId,{...f.input,key:randomUUID()},undefined,f.transport);expect(again.id).toBe(orders[0].id);expect(f.create).toHaveBeenCalledTimes(1);await expect(createChapaCheckout(db,f.userId,{...f.input,amount:'17.00'},undefined,f.transport)).rejects.toMatchObject({status:409,code:'KEY_REUSED'})}
 });
 it('normalizes equivalent top-up amounts but rejects a changed payload for the same key',async()=>{
  const f=await payment({amount:'10'}),order=await f.start();expect((await createChapaCheckout(db,f.userId,{...f.input,amount:'10.00'},undefined,f.transport)).id).toBe(order.id);await expect(createChapaCheckout(db,f.userId,{...f.input,amount:'11.00'},undefined,f.transport)).rejects.toMatchObject({code:'KEY_REUSED'});expect(f.create).toHaveBeenCalledTimes(1);
 });
 it('replays the exact initialization body and reference after an ambiguous timeout',async()=>{
  const f=await payment();f.failNextInitialization();const first=await f.start();expect(first).toMatchObject({status:'PENDING',reason:'INITIALIZATION_PENDING',checkoutUrl:null});const snapshot=await db.chapaCheckout.findUniqueOrThrow({where:{id:first.id}});
  const retried=await f.start();expect(retried.id).toBe(first.id);expect(f.inputs).toHaveLength(2);expect(f.inputs[1]).toEqual(f.inputs[0]);expect(f.inputs[1].merchantReference).toBe(snapshot.merchantReference);expect(JSON.stringify(snapshot.initialization)).not.toContain(f.inputs[0].customer?.phone_number);expect(await balance(f.userId)).toBe('0');expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(1);
 });
 it('charges only the submission fee, accepts a bid once and never reserves its number',async()=>{
  const f=await payment({purpose:'BID',amount:'3.60',fee:30,initialBalance:'5'}),order=await f.start();expect(order.amountCents).toBe('3000');expect(f.inputs[0].amountCents).toBe('3000');const result=await f.verify(order.id);expect(result).toMatchObject({status:'BID_ACCEPTED',bidNumber:'3.6',receipt:{charge:{feePoints:'30',newlyUnavailable:'30'},hold:{extraReserved:'0'}}});expect(await balance(f.userId)).toBe('5');await Promise.all([f.verify(order.id),f.verify(order.id)]);expect(await db.bid.count({where:{auctionId:f.auction!.id,userId:f.userId}})).toBe(1);expect(await db.auctionHold.count({where:{auctionId:f.auction!.id}})).toBe(0);expect(await db.operation.count({where:{userId:f.userId,scope:'CHAPA_RECEIPT'}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('accepts a genuinely earned discount using only its net fee and preserves frozen gross-fee evidence',async()=>{
  const sponsor=await verifiedReferralUser(db),grant=await earnedReferralCoupon(db,sponsor.id),f=await payment({purpose:'BID',userId:sponsor.id,fee:20,couponId:grant.coupon.id}),order=await f.start();expect(order).toMatchObject({grossFee:'20',discountPoints:'2',amountCents:'1800'});const result=await f.verify(order.id);expect(result).toMatchObject({status:'BID_ACCEPTED',receipt:{charge:{feePoints:'20',discountPoints:'2',netFeePoints:'18',newlyUnavailable:'18'}}});expect(await balance(sponsor.id)).toBe('0');expect((await db.bid.findFirstOrThrow({where:{auctionId:f.auction!.id}})).feePoints.toString()).toBe('20');expect(await db.referralRedemption.count({where:{couponId:grant.coupon.id}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('preserves a paid net fee when its earned discount was redeemed during checkout',async()=>{
  const sponsor=await verifiedReferralUser(db);await creditDevelopmentPoints(db,sponsor.id,'100',`chapa-test-${randomUUID()}`);const grant=await earnedReferralCoupon(db,sponsor.id),f=await payment({purpose:'BID',userId:sponsor.id,fee:20,couponId:grant.coupon.id}),order=await f.start(),other=await realReferralAuction(db,10);await submitBid(db,{userId:sponsor.id,auctionSlug:other.slug!,amount:'8.80',feeVersion:1,couponId:grant.coupon.id,key:randomUUID()});const before=await balance(sponsor.id),result=await f.verify(order.id);expect(result).toMatchObject({status:'NEEDS_REVIEW',reason:'COUPON_UNAVAILABLE',fundsPreserved:true});expect(new Prisma.Decimal(await balance(sponsor.id)).sub(before).toString()).toBe('18');expect(await db.bid.count({where:{auctionId:f.auction!.id}})).toBe(0);expect(await db.referralRedemption.count({where:{couponId:grant.coupon.id}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
 it('retains a late verified payment without accepting a bid after the real frozen deadline',async()=>{
  const f=await payment({purpose:'BID',fee:30,endDelayMs:35000}),order=await f.start();await new Promise(resolve=>setTimeout(resolve,35100));const result=await f.verify(order.id);expect(result).toMatchObject({status:'NEEDS_REVIEW',reason:'AUCTION_CLOSED',fundsPreserved:true});expect(await balance(f.userId)).toBe('30');expect(await db.bid.count({where:{auctionId:f.auction!.id}})).toBe(0);await f.verify(order.id);expect(await balance(f.userId)).toBe('30');expect(await reconcile(db)).toEqual([]);
 },50000);
 it('keeps verified incoming funds during maintenance while blocking new checkouts and bids',async()=>{
  const f=await payment({purpose:'BID',fee:30}),order=await f.start(),other=await payment();await db.adminAudit.create({data:{actorId:'isolated-chapa-maintainer',action:'AUCTIONS_MAINTENANCE_HALTED',target:'chapa-local-test',details:{runId:'chapa-local-test'}}});
  try{await expect(other.start()).rejects.toMatchObject({status:503,code:'AUCTIONS_PAUSED'});expect(await f.verify(order.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'AUCTIONS_PAUSED',fundsPreserved:true});expect(await balance(f.userId)).toBe('30');expect(await db.bid.count({where:{auctionId:f.auction!.id}})).toBe(0);expect(await reconcile(db)).toEqual([])}finally{await db.adminAudit.create({data:{actorId:'isolated-chapa-maintainer',action:'AUCTIONS_MAINTENANCE_RESUMED',target:'chapa-local-test',details:{runId:'chapa-local-test'}}})}
 });
 it('reauthorizes after provider lookup and leaves crediting to recovery after caller revocation',async()=>{
  const f=await payment(),order=await f.start();let checks=0;const authorize=async()=>{if(++checks===2)throw Error('Session revoked during verification')};await due(order.id);await expect(verifyChapaCheckout(db,order.id,f.userId,authorize,f.transport)).rejects.toThrow('Session revoked');expect(await balance(f.userId)).toBe('0');expect((await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}})).creditJournalId).toBeNull();await due(order.id);expect(await verifyChapaCheckout(db,order.id,undefined,undefined,f.transport)).toMatchObject({status:'CREDITED'});expect(await balance(f.userId)).toBe('10');expect(await reconcile(db)).toEqual([]);
 });
 it('fails closed on configuration rotation and can recover when creation is switched off',async()=>{
  const f=await payment(),order=await f.start();process.env.CHAPA_PRIVATE_KEY='CHAPA_TEST_'+ 'c'.repeat(40);await expect(f.verify(order.id)).rejects.toMatchObject({status:503,code:'CONFIGURATION_CHANGED'});expect(f.lookup).not.toHaveBeenCalled();expect(await balance(f.userId)).toBe('0');Object.assign(process.env,gateway,{CHAPA_ENABLED:'false'});const another=await payment();await expect(another.start()).rejects.toMatchObject({status:503,code:'PAYMENT_UNAVAILABLE'});expect(await f.verify(order.id)).toMatchObject({status:'CREDITED'});expect(await balance(f.userId)).toBe('10');expect(another.create).not.toHaveBeenCalled();
 });
 it('rejects unsupported amounts and unavailable schemas without making a provider request',async()=>{
  const f=await payment();for(const amount of ['0','0.99','43200.01','1.001','NaN'])await expect(createChapaCheckout(db,f.userId,{key:randomUUID(),purpose:'TOP_UP',amount},undefined,f.transport)).rejects.toThrow();expect(await db.chapaCheckout.count({where:{userId:f.userId}})).toBe(0);process.env.CHAPA_SCHEMA_READY='false';await expect(f.start()).rejects.toMatchObject({status:503,code:'PAYMENT_UNAVAILABLE'});expect(f.create).not.toHaveBeenCalled();
 });
 it('reconciliation skips absent Chapa storage when the schema flag is off',async()=>{
  process.env.CHAPA_SCHEMA_READY='false';const query=vi.fn();expect(await reconcileChapaReceipts({$queryRaw:query} as unknown as PrismaClient)).toEqual([]);expect(query).not.toHaveBeenCalled();
 });
 it('reconciliation accepts real top-up, discounted bid and preserved-payment receipts',async()=>{
  const topup=await payment(),first=await topup.start();await topup.verify(first.id);
  const sponsor=await verifiedReferralUser(db),grant=await earnedReferralCoupon(db,sponsor.id),bid=await payment({purpose:'BID',userId:sponsor.id,fee:20,couponId:grant.coupon.id}),second=await bid.start();expect(await bid.verify(second.id)).toMatchObject({status:'BID_ACCEPTED'});
  const preserved=await payment({purpose:'BID'}),pending=await preserved.start();await db.adminAudit.create({data:{actorId:'isolated-chapa-maintainer',action:'AUCTIONS_MAINTENANCE_HALTED',target:'chapa-reconciliation-test',details:{runId:'chapa-reconciliation-test'}}});try{expect(await preserved.verify(pending.id)).toMatchObject({status:'NEEDS_REVIEW',fundsPreserved:true})}finally{await db.adminAudit.create({data:{actorId:'isolated-chapa-maintainer',action:'AUCTIONS_MAINTENANCE_RESUMED',target:'chapa-reconciliation-test',details:{runId:'chapa-reconciliation-test'}}})}
  expect(await reconcileChapaReceipts(db)).toEqual([]);expect(await reconcile(db)).toEqual([]);
 });
 it('reconciliation detects orphan credits, wrong amounts/users, fabricated state and bid receipts',async()=>{
  const first=await verifiedReferralUser(db),second=await verifiedReferralUser(db),auction=await realReferralAuction(db,10);await creditDevelopmentPoints(db,first.id,'20',`chapa-reconciliation-${randomUUID()}`);
  await expect(db.$transaction(async tx=>{
   for(const userId of [first.id,second.id]){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`},0))`;await ensureWallet(tx,userId)}await seedPlatformAccounts(tx);
   const issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${first.id}:available`}}),hash='a'.repeat(64);
   const orphan=await tx.operation.create({data:{userId:first.id,scope:'CHAPA_RECEIPT',key:randomUUID(),requestHash:hash,result:{synthetic:true}}});const orphanJournal=await tx.journal.create({data:{operationId:orphan.id,kind:'CHAPA_RECEIPT',reference:'synthetic-orphan-chapa',postings:{create:[{accountId:issuance.id,delta:'-3'},{accountId:available.id,delta:'3'}]}}});
   const id=randomUUID(),merchantReference='LW'+randomUUID().replaceAll('-','').slice(0,18),chapaReference='CH'+randomUUID().replaceAll('-','');
   await tx.chapaCheckout.create({data:{id,userId:first.id,purpose:'TOP_UP',mode:'test',credentialFingerprint:'b'.repeat(64),key:randomUUID(),requestHash:hash,initialization:{amountCents:'1000'},merchantReference,amountCents:1000n,expiresAt:new Date(Date.now()+86400000)}});
   const mismatched=await tx.operation.create({data:{userId:second.id,scope:'CHAPA_RECEIPT',key:id,requestHash:hash,result:{checkoutId:id,merchantReference,chapaReference,mode:'test',amountCents:'900',currency:'ETB'}}}),journal=await tx.journal.create({data:{operationId:mismatched.id,kind:'CHAPA_RECEIPT',reference:`chapa:${merchantReference}`,postings:{create:[{accountId:issuance.id,delta:'-9'},{accountId:available.id,delta:'9'}]}}});
   await tx.chapaCheckout.update({where:{id},data:{status:'CREDITED',chapaReference,creditJournalId:journal.id,evidenceHash:hash,receipt:{fabricated:true}}});
   const bidKey=randomUUID(),accepted=await submitBidInTransaction(tx,{userId:first.id,auctionSlug:auction.slug!,feeVersion:1,amount:'6.60',key:bidKey}),bidCheckoutId=randomUUID(),bidMerchant='LW'+randomUUID().replaceAll('-','').slice(0,18),bidReference='CH'+randomUUID().replaceAll('-','');
   await tx.chapaCheckout.create({data:{id:bidCheckoutId,userId:first.id,purpose:'BID',mode:'test',credentialFingerprint:'b'.repeat(64),key:bidKey,requestHash:hash,initialization:{amountCents:'1000'},merchantReference:bidMerchant,amountCents:1000n,auctionId:auction.id,auctionSlug:auction.slug,bidNumber:'6.60',grossFee:'10',feeVersion:1,expiresAt:new Date(Date.now()+86400000)}});
   const bidOperation=await tx.operation.create({data:{userId:first.id,scope:'CHAPA_RECEIPT',key:bidCheckoutId,requestHash:hash,result:{checkoutId:bidCheckoutId,merchantReference:bidMerchant,chapaReference:bidReference,mode:'test',amountCents:'1000',currency:'ETB'}}}),bidJournal=await tx.journal.create({data:{operationId:bidOperation.id,kind:'CHAPA_RECEIPT',reference:`chapa:${bidMerchant}`,postings:{create:[{accountId:issuance.id,delta:'-10'},{accountId:available.id,delta:'10'}]}}});
   await tx.chapaCheckout.update({where:{id:bidCheckoutId},data:{status:'BID_ACCEPTED',chapaReference:bidReference,creditJournalId:bidJournal.id,evidenceHash:hash,bidId:accepted.bid.id,receipt:JSON.parse(JSON.stringify({...accepted,bid:{...accepted.bid,id:randomUUID()}}))}});
   const drift=await reconcileChapaReceipts(tx);expect(drift).toEqual(expect.arrayContaining([{kind:'CHAPA_RECEIPT',name:`journal:${orphanJournal.id}`,code:'JOURNAL_LINK'},{kind:'CHAPA_RECEIPT',name:`operation:${orphan.id}`,code:'OPERATION_LINK'},{kind:'CHAPA_RECEIPT',name:`checkout:${id}`,code:'CHECKOUT_PROOF'},{kind:'CHAPA_RECEIPT',name:`checkout:${id}`,code:'POSTINGS'},{kind:'CHAPA_RECEIPT',name:`checkout:${id}`,code:'PAID_STATE'},{kind:'CHAPA_RECEIPT',name:`checkout:${bidCheckoutId}`,code:'BID_RECEIPT'}]));
   throw Error('ROLLBACK_CHAPA_RECONCILIATION_FIXTURE');
  },{timeout:10000})).rejects.toThrow('ROLLBACK_CHAPA_RECONCILIATION_FIXTURE');
  expect(await reconcileChapaReceipts(db)).toEqual([]);expect(await reconcile(db)).toEqual([]);
 });
});
