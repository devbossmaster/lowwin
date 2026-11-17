import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {verifiedReferralUser,realReferralAuction} from './referral-fixtures';
import {quoteBidBatch} from '../src/modules/auctions/batch';
import {createCurrentDirectCheckout,findCurrentDirectCheckoutByKey,findInlineCheckoutByKey} from '../src/modules/payments/chapa-inline';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {authorizeDirectCheckout} from '../src/modules/payments/chapa-direct';
import {ChapaProviderError,type ChapaDirectCreate,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {reconcile} from '../src/modules/wallet/ledger';
import {TEST_TOKEN} from './helpers';
const database=process.env.CHAPA_CURRENT_DIRECT_TEST_DATABASE_URL;

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
  let id='',merchant='',status='PENDING',validationStatus='PENDING',authType='USSD',capable=true,patch:Record<string,unknown>={};const reference='CH'+randomUUID();
  const proof=()=>({status:'success',data:{merchant_reference:merchant,chapa_reference:reference,amount:4000,currency:'ETB',status,mode:'test',payment_method:'telebirr',meta:{checkout_id:id},...patch}});
  const direct=vi.fn(async(request:ChapaDirectCreate)=>{merchant=request.merchantReference;const row=await db.chapaCheckout.findUniqueOrThrow({where:{merchantReference:merchant}});id=row.id;expect(request.metadata).toEqual({checkout_id:id});expect(row.flowVersion).toBe(5);return {status:'success',data:{auth_type:authType,chapa_reference:reference,payment_status:'PENDING',request_id:'req_'+randomUUID(),expires_at:new Date(Date.now()+300000).toISOString()}}});
  const lookup=vi.fn(async()=>proof()),validate=vi.fn(async(_input:{reference:string;paymentMethod:string;otp?:string})=>({...proof(),data:{...proof().data,status:validationStatus}}));
  const transport:ChapaTransport={direct,lookup,validate,create:vi.fn(async()=>{throw Error('Hosted creation is forbidden')}),methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:capable,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]}))};
  const due=()=>db.chapaCheckout.update({where:{id},data:{nextCheckAt:new Date(0),verificationRetryAfter:null}});
  return {user,auction,command,transport,direct,lookup,validate,id:()=>id,proof,start:(change:Record<string,unknown>={})=>createCurrentDirectCheckout(db,user,{...command,...change},undefined,transport),due,verify:async()=>{await due();return verifyChapaCheckout(db,id,user,undefined,transport)},setStatus:(value:string)=>{status=value},setValidation:(value:string)=>{validationStatus=value},setAuth:(value:string)=>{authType=value},setCapable:(value:boolean)=>{capable=value},alter:(value:Record<string,unknown>)=>{patch=value}};
 }
 it('commits a distinct immutable Direct5 intent before dispatch without any public key or hosted call',async()=>{
  const f=await fixture(),{order}=await f.start();expect(order).toMatchObject({flowVersion:5,chargeType:'DIRECT',apiVersion:'v2',status:'AUTH_NEEDED',authType:'USSD',amount:'40.00'});
  const row=await db.chapaCheckout.findUniqueOrThrow({where:{id:order.id}});expect(row.initialization).toMatchObject({apiVersion:'v2',flowVersion:5,flow:'DIRECT',metadata:{checkout_id:row.id},idempotencyKey:`lowwin-direct-v5:${row.id}`,webhookSignatureProfile:'raw_body'});expect(row.initialization).not.toHaveProperty('publicKeyFingerprint');expect(await balance(f.user)).toBe('0');expect(f.lookup).not.toHaveBeenCalled();
 });
 it('retains one provider operation across concurrent duplicate commands and protocol-specific owned-key discovery',async()=>{
  const f=await fixture(),[one,two]=await Promise.all([f.start(),f.start()]);expect(one.order.id).toBe(two.order.id);expect(f.direct).toHaveBeenCalledOnce();expect(await findCurrentDirectCheckoutByKey(db,f.user,f.command.key)).toMatchObject({id:one.order.id});
  await expect(findInlineCheckoutByKey(db,f.user,f.command.key)).rejects.toMatchObject({status:404});await expect(findCurrentDirectCheckoutByKey(db,(await verifiedReferralUser(db)).id,f.command.key)).rejects.toMatchObject({status:404});
 });
 it('rejects methods lacking Direct capability before persisting or dispatching a charge',async()=>{const f=await fixture();f.setCapable(false);await expect(f.start()).rejects.toMatchObject({code:'METHOD_UNAVAILABLE'});expect(f.direct).not.toHaveBeenCalled();expect(await db.chapaCheckout.count({where:{userId:f.user}})).toBe(0)});
 it('successful USSD validation immediately verifies privately and credits despite a recent pending private lookup',async()=>{
  const f=await fixture();await f.start();await f.verify();expect(f.lookup).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('0');f.setValidation('SUCCESS');f.setStatus('SUCCESS');
  const result=await f.verify();expect(result).toMatchObject({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',completionSignalPending:false});expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.direct).toHaveBeenCalledOnce();expect(await balance(f.user)).toBe('40');await f.verify();expect(await db.journal.count({where:{kind:'CHAPA_RECEIPT',operation:{userId:f.user}}})).toBe(1);
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
