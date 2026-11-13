import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type ChapaCheckout,type PrismaClient} from '@prisma/client';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import {chapaHash,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {chapaPendingVerificationDelay,shouldRefreshChapaAuthorization} from '../src/modules/payments/chapa-verification-policy';

vi.mock('../src/modules/auth/own-contact',async importOriginal=>({...await importOriginal<typeof import('../src/modules/auth/own-contact')>(),decryptPhone:()=>'+251911652904'}));

const id='8d845028-bb7a-4cce-bca6-510bb149ed01',privateKey='CHAPA_TEST_'+'a'.repeat(40);
function fixture(patch:Partial<ChapaCheckout>={}){
 let order={id,userId:'owner',key:id,initialization:{},flowVersion:2,chargeType:'DIRECT',mode:'test',credentialFingerprint:chapaHash(privateKey),merchantReference:'LWowned',amountCents:4000n,currency:'ETB',paymentMethod:'telebirr',status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',reason:null,creditJournalId:null,authorizationReference:'CHowned',authType:'USSD',payerPhoneCipher:'encrypted-fixture',phoneBotId:'fixture-bot',discountPoints:new Prisma.Decimal(0),attempts:1,leaseUntil:null,nextCheckAt:new Date(0),createdAt:new Date(),updatedAt:new Date(),expiresAt:new Date(Date.now()+300000),...patch} as ChapaCheckout;
 const snapshot=()=>({...order});
 const checkout={
  findFirst:vi.fn(async()=>snapshot()),findUniqueOrThrow:vi.fn(async()=>snapshot()),
  updateMany:vi.fn(async({where,data}:any)=>{
   if(order.creditJournalId||where.OR&&order.leaseUntil&&order.leaseUntil.getTime()>Date.now()||where.nextCheckAt&&order.nextCheckAt.getTime()>Date.now())return {count:0};
   order={...order,...data,attempts:data.attempts?order.attempts+data.attempts.increment:order.attempts,updatedAt:new Date()};return {count:1};
  }),
  update:vi.fn(async({data}:any)=>{order={...order,...data,updatedAt:new Date()};return snapshot()}),
 };
 const tx={chapaCheckout:checkout,adminAudit:{findFirst:vi.fn(async()=>null)},$queryRaw:vi.fn(async()=>[snapshot()]),$executeRaw:vi.fn(async()=>1)};
 const db={...tx,$transaction:vi.fn(async(operation:any)=>operation(tx))} as unknown as PrismaClient;
 const validate=vi.fn(async()=>({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}));
 const lookup=vi.fn(async()=>({status:'success',data:{chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',status:'PENDING',mode:'test'}}));
 const transport={validate,lookup,create:vi.fn(),methods:vi.fn()} as ChapaTransport;
 return {db,validate,lookup,transport,row:snapshot,patch:(value:Partial<ChapaCheckout>)=>{order={...order,...value}},verify:()=>verifyChapaCheckout(db,id,'owner',undefined,transport)};
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
 for(const [name,value]of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_speed_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_PRIVATE_KEY:privateKey,CHAPA_WEBHOOK_SECRET:'a'.repeat(64)}))vi.stubEnv(name,value);
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});

describe('bounded Chapa authorization refresh and private verification',()=>{
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
});
