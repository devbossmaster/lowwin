import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ChapaCheckout,PrismaClient} from '@prisma/client';
import {chapaHash,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {timedChapaResponse} from '../src/modules/payments/chapa-timing';

const service=vi.hoisted(()=>({verify:vi.fn(),read:vi.fn()}));
vi.mock('../src/modules/payments/chapa',()=>({
 verifyChapaCheckout:service.verify,getChapaCheckout:service.read,ownChapaCheckout:(order:unknown)=>order,eligible:vi.fn(),
}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:vi.fn(async()=>true)}));
import {authorizeDirectCheckout} from '../src/modules/payments/chapa-direct';

const id='8d845028-bb7a-4cce-bca6-510bb149ed01',privateKey='CHAPA_TEST_'+'a'.repeat(40),publicKey='CHAPA_TEST_PUB_'+'b'.repeat(40);
function fixture(inline:boolean){
 let row={id,userId:'owner',key:id,flowVersion:inline?4:2,chargeType:inline?'INLINE':'DIRECT',initialization:inline?{apiVersion:'v2',flowVersion:4,flow:'INLINE',publicKeyFingerprint:chapaHash(publicKey)}:{},mode:'test',credentialFingerprint:chapaHash(privateKey),merchantReference:'LWowned',amountCents:4000n,currency:'ETB',paymentMethod:'telebirr',status:'AUTH_NEEDED',providerStatus:null,verificationState:'UNVERIFIED',reason:null,creditJournalId:null,authorizationReference:'CHowned',authType:'OTP',validationAttempts:0,leaseUntil:null,nextCheckAt:new Date(0)} as unknown as ChapaCheckout;
 let inTransaction=false,commit:()=>void=()=>{},afterRenew:()=>void=()=>{};
 const snapshot=()=>({...row}),patch=(data:Partial<ChapaCheckout>)=>{row={...row,...data}};
 const matches=(where:Record<string,any>):boolean=>Object.entries(where).every(([key,value])=>{
  if(key==='OR')return value.some(matches);
  const actual=(row as any)[key];
  if(value instanceof Date)return actual instanceof Date&&actual.getTime()===value.getTime();
  if(value&&typeof value==='object')return Object.entries(value).every(([operator,expected]:[string,any])=>operator==='lte'?actual instanceof Date&&actual<=expected:operator==='lt'?actual<expected:false);
  return actual===value;
 });
 const updateMany=vi.fn(async({where,data}:any)=>{
  if(!matches(where))return {count:0};
  patch({...data,...(data.validationAttempts?{validationAttempts:row.validationAttempts+data.validationAttempts.increment}:{})});
  if(!inTransaction&&data.leaseUntil instanceof Date)afterRenew();
  return {count:1};
 });
 const checkout={findFirst:vi.fn(async()=>snapshot()),updateMany};
 const client={chapaCheckout:checkout,$transaction:vi.fn(async(operation:any)=>{
  inTransaction=true;try{return await operation({chapaCheckout:checkout})}finally{inTransaction=false;commit()}
 })} as unknown as PrismaClient;
 const validate=vi.fn(async()=>{
  expect(inTransaction).toBe(false);
  expect(row.leaseUntil!.getTime()-Date.now()).toBeGreaterThanOrEqual(18000);
  return {status:'success',data:{status:'PENDING',chapa_reference:'CHowned',merchant_reference:'LWowned',amount:4000,currency:'ETB',payment_method:'telebirr',mode:'test'}};
 });
 const transport={validate,lookup:vi.fn(),create:vi.fn(),methods:vi.fn()} as unknown as ChapaTransport;
 service.read.mockImplementation(async()=>snapshot());service.verify.mockImplementation(async()=>snapshot());
 return {client,validate,transport,row:snapshot,patch,updateMany,onCommit:(callback:()=>void)=>{commit=callback},onRenew:(callback:()=>void)=>{afterRenew=callback},authorize:(reauthorize?:()=>Promise<void>)=>authorizeDirectCheckout(client,'owner',id,{otp:'123456'},reauthorize,transport)};
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));vi.clearAllMocks();
 for(const [name,value]of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_otp_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PUBLIC_KEY:publicKey,CHAPA_PRIVATE_KEY:privateKey,CHAPA_WEBHOOK_SECRET:'a'.repeat(64)}))vi.stubEnv(name,value);
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected real provider request'));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks()});

describe.each([['Inline',true],['Direct',false]] as const)('%s OTP dispatch lease',(_name,inline)=>{
 it('reports the authorization validation duration without recording OTP or payment identifiers',async()=>{
  const f=fixture(inline),response=await timedChapaResponse(async()=>{await f.authorize();return Response.json({status:'AUTH_NEEDED'})});
  expect(response.headers.get('Server-Timing')).toMatch(/^validate;dur=\d+\.\d, total;dur=\d+\.\d$/);
  expect(response.headers.get('Server-Timing')).not.toMatch(/123456|CHowned|LWowned/);expect(f.validate).toHaveBeenCalledOnce();
 });
 it('starts its dispatch lease after slow reauthorization and keeps HTTP outside the transaction',async()=>{
  const f=fixture(inline);await f.authorize(async()=>{vi.advanceTimersByTime(25000)});
  expect(f.validate).toHaveBeenCalledExactlyOnceWith({reference:'CHowned',paymentMethod:'telebirr',otp:'123456'});
  expect(service.verify).toHaveBeenCalledOnce();expect(f.row().leaseUntil).toBeNull();expect(f.row().validationAttempts).toBe(1);
 });
 it('renews the owned fence after a delayed claim commit before sending the original OTP request once',async()=>{
  const f=fixture(inline);f.onCommit(()=>vi.advanceTimersByTime(12000));
  await f.authorize();expect(f.validate).toHaveBeenCalledOnce();expect(service.verify).toHaveBeenCalledOnce();expect(f.row().leaseUntil).toBeNull();
  expect(f.row().authorizationReference).toBe('CHowned');expect(f.row().validationAttempts).toBe(1);expect(JSON.stringify(f.row().initialization)).not.toContain('123456');
 });
 it('does not extend or release a successor lease after an expired claim response',async()=>{
  const f=fixture(inline);let successor:Date;
  f.onCommit(()=>{vi.advanceTimersByTime(21000);successor=new Date(Date.now()+45000);f.patch({leaseUntil:successor,status:'VERIFYING'})});
  await expect(f.authorize()).resolves.toMatchObject({status:'VERIFYING'});
  expect(f.validate).not.toHaveBeenCalled();expect(service.verify).not.toHaveBeenCalled();expect(f.row().leaseUntil).toEqual(successor!);
 });
 it('defers without provider HTTP when the bounded renewal also returns with too little time remaining',async()=>{
  const f=fixture(inline);f.onCommit(()=>vi.advanceTimersByTime(12000));f.onRenew(()=>vi.advanceTimersByTime(4000));
  await expect(f.authorize()).resolves.toMatchObject({id,status:'AUTH_NEEDED',verificationUnavailable:true});
  expect(f.validate).not.toHaveBeenCalled();expect(service.verify).not.toHaveBeenCalled();expect(f.row().leaseUntil).toBeNull();
  expect(f.row().key).toBe(id);expect(f.row().authorizationReference).toBe('CHowned');expect(f.row().providerStatus).toBeNull();
 });
 it('preserves a successor that takes over while the renewal response is delayed',async()=>{
  const f=fixture(inline);let successor:Date;f.onCommit(()=>vi.advanceTimersByTime(12000));
  f.onRenew(()=>{vi.advanceTimersByTime(21000);successor=new Date(Date.now()+45000);f.patch({leaseUntil:successor,status:'VERIFYING'})});
  await expect(f.authorize()).resolves.toMatchObject({status:'VERIFYING'});
  expect(f.validate).not.toHaveBeenCalled();expect(service.verify).not.toHaveBeenCalled();expect(f.row().leaseUntil).toEqual(successor!);
 });
});
