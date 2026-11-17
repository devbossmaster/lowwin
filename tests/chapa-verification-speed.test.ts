import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {authorizeDirectCheckout} from '../src/modules/payments/chapa-direct';
import {chapaHash,ChapaProviderError,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {chapaPendingVerificationDelay,shouldRefreshChapaAuthorization} from '../src/modules/payments/chapa-verification-policy';

vi.mock('../src/modules/auth/own-contact',async importOriginal=>({...await importOriginal<typeof import('../src/modules/auth/own-contact')>(),decryptPhone:()=>'+251911652904'}));
vi.mock('../src/lib/rate-limit',async importOriginal=>({...await importOriginal<typeof import('../src/lib/rate-limit')>(),allowIdentityRequest:vi.fn(async()=>true)}));
const notifications=vi.hoisted(()=>({publish:vi.fn(async(_id:string)=>{})}));
vi.mock('../src/modules/payments/chapa-committed',()=>({publishChapaCommitted:notifications.publish}));

const id='8d845028-bb7a-4cce-bca6-510bb149ed01',privateKey='CHAPA_TEST_'+'a'.repeat(40);
function fixture(patch:Partial<ChapaCheckout>={}){
 let order={id,userId:'owner',key:id,initialization:{},flowVersion:2,chargeType:'DIRECT',mode:'test',credentialFingerprint:chapaHash(privateKey),merchantReference:'LWowned',amountCents:4000n,currency:'ETB',paymentMethod:'telebirr',status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',reason:null,creditJournalId:null,authorizationReference:'CHowned',authType:'USSD',payerPhoneCipher:'encrypted-fixture',phoneBotId:'fixture-bot',discountPoints:new Prisma.Decimal(0),attempts:1,leaseUntil:null,nextCheckAt:new Date(0),verificationSignalVersion:0,verificationHandledSignalVersion:0,verificationCompletionStatus:null,lastPrivateCheckAt:null,verificationRetryAfter:null,createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+300000),...patch} as ChapaCheckout;
 const snapshot=()=>({...order});
 const matches=(where:Record<string,any>):boolean=>Object.entries(where).every(([key,value])=>{
  if(key==='OR')return value.some(matches);if(key==='AND')return value.every(matches);if(key==='NOT')return !matches(value);
  const actual=(order as any)[key];
  if(value instanceof Date)return actual instanceof Date&&actual.getTime()===value.getTime();
  if(value&&typeof value==='object')return Object.entries(value).every(([operator,expected]:[string,any])=>operator==='lte'?actual instanceof Date&&actual<=expected:operator==='lt'?actual<expected:operator==='in'?expected.includes(actual):operator==='not'?actual!==expected:operator==='startsWith'?typeof actual==='string'&&actual.startsWith(expected):false);
  return actual===value;
 });
 const checkout={
  findFirst:vi.fn(async({where}:any)=>matches(where)?snapshot():null),findUniqueOrThrow:vi.fn(async()=>snapshot()),
  updateMany:vi.fn(async({where,data}:any)=>{
   if(!matches(where))return {count:0};
   const increments=Object.fromEntries(Object.entries(data).filter(([,value])=>value&&typeof value==='object'&&'increment'in value).map(([key,value])=>[key,(order as any)[key]+(value as any).increment]));
   order={...order,...data,...increments,updatedAt:new Date()};return {count:1};
  }),
  update:vi.fn(async({data}:any)=>{order={...order,...data,updatedAt:new Date()};return snapshot()}),
 };
 const tx={chapaCheckout:checkout,chapaWebhookEvent:{findFirst:vi.fn(async()=>null)},adminAudit:{findFirst:vi.fn(async()=>null)},$queryRaw:vi.fn(async(strings:TemplateStringsArray,...values:unknown[])=>{
  if(strings.join('').includes('"verificationSignalVersion"="verificationSignalVersion"+1')){
   if(order.creditJournalId)return [];
   const [feedbackPresent,feedbackReason,completion]=values;
   const canRecord=feedbackPresent&&['SUBMITTING','PENDING','VERIFYING','AUTH_NEEDED'].includes(order.status)&&order.verificationState!=='MISMATCH'&&(!order.providerStatus||['PENDING','AUTH_NEEDED'].includes(order.providerStatus))&&(!order.reason||!order.reason.startsWith('CHAPA_')||order.reason.startsWith('CHAPA_AUTHORIZATION_'));
   order={...order,verificationSignalVersion:order.verificationSignalVersion+1,verificationCompletionStatus:order.verificationCompletionStatus==='SUCCESS'?'SUCCESS':completion as string??order.verificationCompletionStatus,nextCheckAt:new Date(Math.max(Date.now(),order.verificationRetryAfter?.getTime()??0)),...(canRecord?{reason:feedbackReason as string}:{}),updatedAt:new Date()};
   if(order.verificationCompletionStatus&&['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'].includes(order.status))order.status='NEEDS_REVIEW';
  }
  return [snapshot()];
 }),$executeRaw:vi.fn(async()=>1)};
 const db={...tx,$transaction:vi.fn(async(operation:any)=>operation(tx))} as unknown as PrismaClient;
 const validate=vi.fn(async()=>({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}));
 const lookup=vi.fn(async()=>({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}));
 const transport={validate,lookup,create:vi.fn(),methods:vi.fn()} as ChapaTransport;
 return {db,validate,lookup,transport,row:snapshot,patch:(value:Partial<ChapaCheckout>)=>{order={...order,...value}},verify:()=>verifyChapaCheckout(db,id,'owner',undefined,transport)};
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
 notifications.publish.mockClear();
 for(const [name,value]of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_speed_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(40),CHAPA_PRIVATE_KEY:privateKey,CHAPA_WEBHOOK_SECRET:'a'.repeat(64)}))vi.stubEnv(name,value);
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});

describe('bounded Chapa authorization refresh and private verification',()=>{
 const inlinePatch=():Partial<ChapaCheckout>=>({flowVersion:4,chargeType:'INLINE',initialization:{apiVersion:'v2',flowVersion:4,flow:'INLINE',publicKeyFingerprint:chapaHash(process.env.CHAPA_PUBLIC_KEY!)}});
 it('clears stale authorization rejection when matching pending validation saves a redundant private GET',async()=>{
  const f=fixture({...inlinePatch(),status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',reason:'CHAPA_AUTHORIZATION_INVALID_PIN',lastPrivateCheckAt:new Date()});
  await expect(f.verify()).resolves.toMatchObject({authorizationReasonCode:null,providerStatus:'PENDING'});expect(f.lookup).not.toHaveBeenCalled();
 });
 it('does not suppress private verification using a timestamp from a later server clock',async()=>{
  const f=fixture({...inlinePatch(),status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',lastPrivateCheckAt:new Date(Date.now()+60000)});
  await f.verify();expect(f.lookup).toHaveBeenCalledOnce();
 });
 it('measures private-check freshness from the HTTP response rather than a later financial lock acquisition',async()=>{
  const f=fixture(inlinePatch()),checkedAt=new Date();const transaction=vi.mocked(f.db.$transaction),original=transaction.getMockImplementation()! as any;let transactions=0;
  transaction.mockImplementation(async(operation:any)=>{if(++transactions===2)vi.advanceTimersByTime(20000);return original(operation)});
  await f.verify();expect(f.row().lastPrivateCheckAt).toEqual(checkedAt);vi.advanceTimersByTime(10000);await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);
 });
 it('starts provider HTTP with a fresh fenced lease after slow reauthorization',async()=>{
  const f=fixture(inlinePatch());let reauthorized=0,remainingLease=0;
  f.validate.mockImplementationOnce(async()=>{remainingLease=f.row().leaseUntil!.getTime()-Date.now();return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  await verifyChapaCheckout(f.db,id,'owner',async()=>{if(!reauthorized++)vi.advanceTimersByTime(25000)},f.transport);
  expect(remainingLease).toBe(45000);
 });
 it('does not dispatch provider HTTP after a delayed claim response has already lost its lease',async()=>{
  const f=fixture(inlinePatch()),write=vi.mocked(f.db.chapaCheckout.updateMany),original=write.getMockImplementation()! as any;let delayed=false,successorLease:Date|undefined;
  write.mockImplementation((async(args:any)=>{const result=await original(args);if(args.data.attempts&&!delayed){delayed=true;vi.advanceTimersByTime(46000);successorLease=new Date(Date.now()+45000);f.patch({leaseUntil:successorLease,status:'VERIFYING'})}return result}) as any);
  await expect(f.verify()).resolves.toMatchObject({status:'VERIFYING'});expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).not.toHaveBeenCalled();expect(f.row().leaseUntil).toEqual(successorLease);
 });
 it('defers without provider HTTP when the one fenced renewal also consumes its dispatch budget',async()=>{
  const f=fixture(inlinePatch()),write=vi.mocked(f.db.chapaCheckout.updateMany),original=write.getMockImplementation()! as any;
  write.mockImplementation((async(args:any)=>{const result=await original(args);if(args.data.attempts||args.data.leaseUntil&&args.where.leaseUntil instanceof Date)vi.advanceTimersByTime(25000);return result}) as any);
  await f.verify();expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).not.toHaveBeenCalled();expect(f.row().leaseUntil).toBeNull();expect(write).toHaveBeenCalledTimes(3);
 });
 it('keeps a newer provider backoff due time when a webhook was read just before that backoff committed',async()=>{
  const f=fixture(inlinePatch()),retryAt=new Date(Date.now()+60000);
  vi.mocked(f.db.chapaCheckout.findFirst).mockImplementationOnce((async()=>{const stale=f.row();f.patch({verificationRetryAfter:retryAt,nextCheckAt:retryAt});return stale}) as any);
  await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');expect(f.row().nextCheckAt).toEqual(retryAt);expect(f.row().verificationSignalVersion).toBe(1);expect(f.lookup).not.toHaveBeenCalled();
 });
 it.each([{feedback:{kind:'rejected',code:'INVALID_OTP'},reason:'CHAPA_AUTHORIZATION_INVALID_OTP'},{feedback:{kind:'waiting'},reason:'PAYMENT_NOT_COMPLETED'}] as const)('durably retains OTP feedback $feedback.kind when another verifier already owns the lease',async({feedback,reason})=>{
  const f=fixture({...inlinePatch(),authType:'OTP',status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',reason:'CHAPA_AUTHORIZATION_INVALID_PIN',leaseUntil:new Date(Date.now()+45000)});
  await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,true,feedback);expect(f.row().reason).toBe(reason);expect(f.row().verificationSignalVersion).toBe(1);expect(f.lookup).not.toHaveBeenCalled();expect(f.validate).not.toHaveBeenCalled();
 });
 it.each(['pending','unavailable'])('keeps newer OTP rejection above an earlier authorization response when private verification is %s',async result=>{
  const f=fixture({...inlinePatch(),authType:'OTP',status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED'});
  f.lookup.mockImplementationOnce(async()=>{await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,true,{kind:'rejected',code:'INVALID_OTP'});if(result==='unavailable')throw new Error('Synthetic provider outage');return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  const response=await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,true,{kind:'waiting'});expect(response).toMatchObject({authorizationReasonCode:'INVALID_OTP',providerStatus:'PENDING'});expect(f.row().reason).toBe('CHAPA_AUTHORIZATION_INVALID_OTP');expect(f.row().creditJournalId).toBeNull();
 });
 it('skips redundant pending Inline GETs but performs a private lookup at least every thirty seconds',async()=>{
  const f=fixture(inlinePatch());await f.verify();expect(f.lookup).toHaveBeenCalledOnce();
  for(let cycle=0;cycle<5;cycle++){vi.advanceTimersByTime(5000);await f.verify()}
  expect(f.validate).toHaveBeenCalledTimes(6);expect(f.lookup).toHaveBeenCalledOnce();expect(f.row().verificationState).toBe('VERIFIED');
  vi.advanceTimersByTime(5000);await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.row().lastPrivateCheckAt).toEqual(new Date());
 });
 it.each(['amount','merchant_reference','chapa_reference','payment_method','mode'])('never skips private verification for a pending Inline validation with mismatched %s',async field=>{
  const f=fixture(inlinePatch());await f.verify();vi.advanceTimersByTime(5000);
  f.validate.mockResolvedValueOnce({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test',[field]:field==='amount'?3999:'mismatch'}});
  await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);
 });
 it('privately verifies a completion validation even during the pending optimization window',async()=>{
  const f=fixture(inlinePatch());await f.verify();vi.advanceTimersByTime(5000);
  f.validate.mockResolvedValueOnce({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'SUCCESS',mode:'test'}});
  await f.verify();expect(f.lookup).toHaveBeenCalledTimes(3);expect(f.row().creditJournalId).toBeNull();expect(f.row().providerStatus).toBe('PENDING');expect(f.row().verificationCompletionStatus).toBe('SUCCESS');
 });
 it('retains completion through private pending and stale Inline pending, then honors a fresh private terminal outcome',async()=>{
  const f=fixture(inlinePatch());f.validate.mockResolvedValueOnce({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'SUCCESS',mode:'test'}});
  await expect(f.verify()).resolves.toMatchObject({status:'PENDING',completionSignalPending:true});expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.row().verificationHandledSignalVersion).toBe(0);
  vi.advanceTimersByTime(5000);await f.verify();expect(f.lookup).toHaveBeenCalledTimes(3);expect(f.row().verificationSignalVersion).toBe(1);expect(f.row().verificationCompletionStatus).toBe('SUCCESS');
  f.lookup.mockResolvedValueOnce({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'FAILED',mode:'test'}});vi.advanceTimersByTime(5000);
  await expect(f.verify()).resolves.toMatchObject({status:'FAILED',providerStatus:'FAILED',completionSignalPending:false});expect(f.row().verificationCompletionStatus).toBeNull();expect(f.row().verificationHandledSignalVersion).toBe(1);expect(f.row().creditJournalId).toBeNull();
 });
 it('shows review while a later terminal hint waits behind an active lease, then lets a fresh private failure resolve it',async()=>{
  const f=fixture({...inlinePatch(),status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',leaseUntil:new Date(Date.now()+45000)});
  await expect(verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook',undefined,'SUCCESS')).resolves.toMatchObject({status:'NEEDS_REVIEW',providerStatus:'FAILED',completionSignalPending:true});expect(f.lookup).not.toHaveBeenCalled();
  f.patch({leaseUntil:null,nextCheckAt:new Date(0)});f.lookup.mockResolvedValueOnce({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'FAILED',mode:'test'}});
  await expect(f.verify()).resolves.toMatchObject({status:'FAILED',providerStatus:'FAILED',completionSignalPending:false});expect(f.row().verificationCompletionStatus).toBeNull();
 });
 it('retains a webhook received during a private pending lookup and immediately runs one serialized deferred lookup',async()=>{
  const f=fixture(inlinePatch());let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  f.lookup.mockImplementationOnce(async()=>{entered();await gate;return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  const first=f.verify();await started;
  expect(f.row().nextCheckAt).toEqual(new Date(0));expect(f.row().leaseUntil!.getTime()-Date.now()).toBe(45000);
  await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');expect(f.row().verificationSignalVersion).toBe(1);expect(f.lookup).toHaveBeenCalledOnce();
  release();await first;expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.validate).toHaveBeenCalledOnce();expect(f.row().verificationHandledSignalVersion).toBe(1);expect(f.row().leaseUntil).toBeNull();
 });
 it('retains a signal received during Inline validation instead of skipping its required private lookup',async()=>{
  const f=fixture(inlinePatch());await f.verify();vi.advanceTimersByTime(5000);
  f.validate.mockImplementationOnce(async()=>{await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  await f.verify();expect(f.lookup).toHaveBeenCalledTimes(3);expect(f.row().verificationHandledSignalVersion).toBe(1);
 });
 it('caps an invocation at one deferred pass and leaves newer signals durably due',async()=>{
  const f=fixture(inlinePatch());f.lookup.mockImplementation(async()=>{await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.row().verificationSignalVersion).toBe(2);expect(f.row().verificationHandledSignalVersion).toBe(1);expect(f.row().nextCheckAt).toEqual(new Date());
 });
 it('retains a newer signal even if the lookup already in flight reports an older failed outcome',async()=>{
  const f=fixture(inlinePatch());f.lookup.mockImplementationOnce(async()=>{await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'FAILED',mode:'test'}}});
  await expect(f.verify()).resolves.toMatchObject({status:'PENDING',providerStatus:'PENDING'});expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.row().verificationHandledSignalVersion).toBe(1);
 });
 it('rejects another account before registering a signal or touching provider HTTP',async()=>{
  const f=fixture(inlinePatch());await expect(verifyChapaCheckout(f.db,id,'different-owner',undefined,f.transport,true)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(f.row().verificationSignalVersion).toBe(0);expect(f.lookup).not.toHaveBeenCalled();expect(f.validate).not.toHaveBeenCalled();expect(f.db.chapaCheckout.updateMany).not.toHaveBeenCalled();expect(notifications.publish).not.toHaveBeenCalled();
 });
 it('persists provider throttling backoff while retaining completion signals for recovery',async()=>{
  const f=fixture(inlinePatch());f.lookup.mockRejectedValueOnce(new ChapaProviderError(429,'RATE_LIMITED'));
  await f.verify();await verifyChapaCheckout(f.db,id,'owner',undefined,f.transport,'webhook');expect(f.lookup).toHaveBeenCalledOnce();expect(f.row().verificationSignalVersion).toBe(1);expect(f.row().verificationHandledSignalVersion).toBe(0);expect(f.row().verificationRetryAfter!.getTime()-Date.now()).toBe(60000);
  vi.advanceTimersByTime(60000);await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);expect(f.row().verificationHandledSignalVersion).toBe(1);expect(f.row().verificationRetryAfter).toBeNull();
 });
 it('keeps provider requests outside transactions and publishes only after the transaction commits without waiting for Redis',async()=>{
  const f=fixture(inlinePatch());let inTransaction=false;
  const original=vi.mocked(f.db.$transaction).getMockImplementation()! as any;vi.mocked(f.db.$transaction).mockImplementation(async(operation:any)=>{inTransaction=true;try{return await original(operation)}finally{inTransaction=false}});
  f.validate.mockImplementation(async()=>{expect(inTransaction).toBe(false);return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  f.lookup.mockImplementation(async()=>{expect(inTransaction).toBe(false);return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  notifications.publish.mockImplementationOnce(async()=>{expect(inTransaction).toBe(false);expect(f.row().providerStatus).toBe('PENDING');await new Promise<void>(()=>{})});
  await expect(f.verify()).resolves.toMatchObject({providerStatus:'PENDING'});expect(notifications.publish).toHaveBeenCalledExactlyOnceWith(id);
 });
 it.each(['waiting','rejected','unavailable'])('does not release a newer lease after a delayed OTP %s response',async response=>{
  const f=fixture({authType:'OTP',validationAttempts:0});let successorLease:Date;
  f.validate.mockImplementationOnce(async()=>{
   vi.advanceTimersByTime(21000);successorLease=new Date(Date.now()+45000);
   f.patch({status:'VERIFYING',leaseUntil:successorLease,nextCheckAt:successorLease});
   if(response==='unavailable')throw new Error('Temporary provider transport failure');
   return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:response==='rejected'?'FAILED':'PENDING',mode:'test'}};
  });
  const authorize=authorizeDirectCheckout(f.db,'owner',id,{otp:'123456'},undefined,f.transport);
  if(response==='unavailable')await expect(authorize).rejects.toThrow('Temporary provider transport failure');
  else await expect(authorize).resolves.toMatchObject({status:'VERIFYING'});
  expect(f.row().leaseUntil).toEqual(successorLease!);expect(f.row().nextCheckAt).toEqual(successorLease!);
  expect(f.lookup).not.toHaveBeenCalled();expect(f.row().reason).toBeNull();
 });
 it('releases only its own OTP lease then verifies the original reference once',async()=>{
  const f=fixture({authType:'OTP',validationAttempts:0});
  await expect(authorizeDirectCheckout(f.db,'owner',id,{otp:'123456'},undefined,f.transport)).resolves.toMatchObject({status:'PENDING'});
  expect(f.validate).toHaveBeenCalledExactlyOnceWith({reference:'CHowned',paymentMethod:'telebirr',otp:'123456'});
  expect(f.lookup).toHaveBeenCalledExactlyOnceWith('LWowned');expect(f.row().leaseUntil).toBeNull();
 });
 it('refreshes an active prompt after five seconds and keeps cooldown reads free of provider HTTP',async()=>{
  const f=fixture();expect(await f.verify()).toMatchObject({status:'PENDING'});expect(f.row().nextCheckAt.getTime()-Date.now()).toBe(5000);
  await f.verify();vi.advanceTimersByTime(4999);await f.verify();expect(f.validate).toHaveBeenCalledOnce();expect(f.lookup).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);await f.verify();expect(f.validate).toHaveBeenCalledTimes(2);expect(f.lookup).toHaveBeenCalledTimes(2);
 });
 it('returns to the existing fifteen-second cadence after the first minute',async()=>{
  const f=fixture({createdAt:new Date(Date.now()-60000)});await f.verify();expect(f.row().nextCheckAt.getTime()-Date.now()).toBe(15000);
  vi.advanceTimersByTime(14999);await f.verify();expect(f.lookup).toHaveBeenCalledOnce();vi.advanceTimersByTime(1);await f.verify();expect(f.lookup).toHaveBeenCalledTimes(2);
 });
 it('serializes simultaneous checks into one validation and private lookup under the lease',async()=>{
  const f=fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  f.validate.mockImplementationOnce(async()=>{entered();await gate;return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}});
  const first=f.verify();await started;expect(await f.verify()).toMatchObject({status:'AUTH_NEEDED'});expect(f.validate).toHaveBeenCalledOnce();expect(f.lookup).not.toHaveBeenCalled();release();await first;expect(f.lookup).toHaveBeenCalledOnce();
 });
 it.each(['FAILED','CANCELLED','INCOMPLETE','EXPIRED','BLOCKED'])('skips old USSD validation after verified %s but still privately looks up the original payment',async status=>{
  const f=fixture({status,providerStatus:status,verificationState:'VERIFIED'});f.lookup.mockResolvedValue({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status,mode:'test'}});
  await f.verify();expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledExactlyOnceWith('LWowned');
 });
 it('does not infer provider expiry from the local five-minute display deadline',async()=>{
  const f=fixture({createdAt:new Date(Date.now()-360000),expiresAt:new Date(Date.now()-60000)});await f.verify();expect(f.validate).toHaveBeenCalledOnce();expect(f.lookup).toHaveBeenCalledOnce();expect(f.row().status).toBe('PENDING');
 });
 it('accepts late privately verified success after expiry without revalidating the old prompt or replacing a concurrent credit',async()=>{
  const f=fixture({status:'EXPIRED',providerStatus:'EXPIRED',verificationState:'VERIFIED'});
  f.lookup.mockImplementationOnce(async()=>{f.patch({status:'CREDITED',providerStatus:'SUCCESS',creditJournalId:'concurrent-verified-receipt'});return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',customer:{phone_number:'251911652904'},status:'SUCCESS',mode:'test'}}});
  expect(await f.verify()).toMatchObject({status:'CREDITED',providerStatus:'SUCCESS'});expect(f.validate).not.toHaveBeenCalled();expect(f.lookup).toHaveBeenCalledOnce();
 });
 it('keeps nonauthorization and expired-window recovery backoff unchanged',()=>{
  const f=fixture({attempts:80,expiresAt:new Date(Date.now()-1)}).row();expect(chapaPendingVerificationDelay(f,true)).toBe(300000);expect(chapaPendingVerificationDelay({...f,attempts:1},false)).toBe(15000);
  expect(shouldRefreshChapaAuthorization({...f,providerStatus:'EXPIRED',verificationState:'UNVERIFIED'})).toBe(true);expect(shouldRefreshChapaAuthorization({...f,authType:'OTP'})).toBe(false);
 });
 it.each(['PENDING','SUCCESS'])('discards an old %s response after a successor owns the verification lease',async status=>{
  const f=fixture();let successorLease:Date;
  f.lookup.mockImplementationOnce(async()=>{
   vi.advanceTimersByTime(46000);successorLease=new Date(Date.now()+45000);
   f.patch({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',reason:'CHAPA_PAYMENT_CANCELLED',leaseUntil:successorLease,nextCheckAt:successorLease});
   return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',customer:{phone_number:'251911652904'},status,mode:'test'}};
  });
  expect(await f.verify()).toMatchObject({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED'});
  expect(f.row().leaseUntil).toEqual(successorLease!);expect(f.row().nextCheckAt).toEqual(successorLease!);expect(f.row().creditJournalId).toBeNull();
 });
 it('does not let an old mismatched response quarantine a successor verification',async()=>{
  const f=fixture();let successorLease:Date;
  f.lookup.mockImplementationOnce(async()=>{
   vi.advanceTimersByTime(46000);successorLease=new Date(Date.now()+45000);
   f.patch({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',leaseUntil:successorLease,nextCheckAt:successorLease});
   return {status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:9999,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}};
  });
  expect(await f.verify()).toMatchObject({status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED'});expect(f.row().leaseUntil).toEqual(successorLease!);
 });
 it('does not let an old lookup outage release a successor lease or delay its due check',async()=>{
  const f=fixture();let successorLease:Date;
  f.lookup.mockImplementationOnce(async()=>{
   vi.advanceTimersByTime(46000);successorLease=new Date(Date.now()+45000);
   f.patch({status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',leaseUntil:successorLease,nextCheckAt:successorLease});throw Error('Synthetic interrupted verification');
  });
  expect(await f.verify()).toMatchObject({status:'PENDING',providerStatus:'PENDING',verificationState:'VERIFIED',verificationUnavailable:true});
  expect(f.row().leaseUntil).toEqual(successorLease!);expect(f.row().nextCheckAt).toEqual(successorLease!);
 });
});
