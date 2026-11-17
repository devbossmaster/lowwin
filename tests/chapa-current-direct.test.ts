import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCurrentDirectTransport,currentDirectAvailability,currentDirectBinding,currentDirectEngineTransport} from '../src/modules/payments/chapa-current-direct-provider';
import {isCurrentDirectCheckout,isCurrentV2Checkout} from '../src/modules/payments/chapa-current-protocol';
import {chapaHash,createdChapaDirect,createdCurrentChapaDirect} from '../src/modules/payments/chapa-provider';
import {chapaCurrentV2,chapaOriginalKeyUrl,chapaOriginalRecoveryUrl} from '../src/lib/chapa-client';
import {readChapaRecoveryPointer,retainChapaRecoveryPointer} from '../src/lib/chapa-recovery-pointer';
import {matchesChapaMetadata} from '../src/modules/payments/chapa-metadata';

const env={APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://postgres@127.0.0.1:55614/local_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'',CHAPA_WEBHOOK_SECRET:'b'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test'};
const key='11111111-2222-4333-8444-555555555555',initialization={apiVersion:'v2',flowVersion:5,flow:'DIRECT',metadata:{checkout_id:key}};
const acceptedUssd={status:'success',data:{auth_type:'',chapa_reference:'CH-original',payment_status:'Accepted',request_id:'request-original'}};
afterEach(()=>vi.unstubAllEnvs());
describe('current v2 Direct protocol boundaries',()=>{
 it.each(['telebirr','mpesa'])('normalizes the observed accepted %s response to USSD only for current Direct creation',method=>{
  expect(createdCurrentChapaDirect(acceptedUssd,method)).toEqual({authType:'USSD',reference:'CH-original',requestId:'request-original',createdAt:undefined,expiresAt:undefined});
  expect(createdChapaDirect(acceptedUssd)).toBeNull();
 });
 it.each(['cbebirr','ebirr','cbe-bank','unknown'])('never infers USSD authorization for an empty %s authorization type',method=>{
  expect(createdCurrentChapaDirect(acceptedUssd,method)).toBeNull();
 });
 it.each([
  {auth_type:undefined},{auth_type:null},{auth_type:' '},{auth_type:'PIN'},
  {payment_status:'SUCCESS'},{payment_status:'PENDING'},{payment_status:'accepted'},
  {chapa_reference:undefined},{chapa_reference:''},{chapa_reference:'bad reference'},
  {request_id:undefined},{request_id:''},{request_id:'   '},{request_id:'x'.repeat(257)},
 ])('rejects unsupported or unbound accepted response variation %#',change=>{
  expect(createdCurrentChapaDirect({...acceptedUssd,data:{...acceptedUssd.data,...change}},'telebirr')).toBeNull();
 });
 it('requires operation-level success and preserves explicit documented OTP or USSD authorization',()=>{
  expect(createdCurrentChapaDirect({...acceptedUssd,status:'failed'},'telebirr')).toBeNull();
  for(const auth_type of ['OTP','USSD'])expect(createdCurrentChapaDirect({...acceptedUssd,data:{...acceptedUssd.data,auth_type}},'telebirr')).toMatchObject({authType:auth_type,reference:'CH-original'});
 });
 it('does not let the observed equal-millisecond nanosecond expiry end the saved local authorization window',()=>{
  const observed={...acceptedUssd,data:{...acceptedUssd.data,created_at:'2026-11-17T18:56:30.326927837Z',expires_at:'2026-11-17T18:56:30.326927992Z'}};
  expect(createdCurrentChapaDirect(observed,'telebirr',Date.parse('2026-11-17T18:56:29Z'))).toMatchObject({authType:'USSD',createdAt:new Date('2026-11-17T18:56:30.326Z'),expiresAt:undefined});
 });
 it.each(['invalid','2026-11-17T18:55:00Z','2026-11-17T18:56:30Z'])('drops an unusable expiry hint %s without rejecting accepted authorization',expires_at=>{
  const response={...acceptedUssd,data:{...acceptedUssd.data,created_at:'2026-11-17T18:56:30Z',expires_at}};
  expect(createdCurrentChapaDirect(response,'telebirr',Date.parse('2026-11-17T18:56:31Z'))).toMatchObject({authType:'USSD',expiresAt:undefined});
 });
 it('preserves a valid future provider expiry for explicit or inferred authorization',()=>{
  for(const auth_type of ['','USSD','OTP'])expect(createdCurrentChapaDirect({...acceptedUssd,data:{...acceptedUssd.data,auth_type,created_at:'2026-11-17T18:56:30Z',expires_at:'2026-11-17T19:01:30Z'}},'telebirr',Date.parse('2026-11-17T18:56:31Z'))).toMatchObject({authType:auth_type||'USSD',expiresAt:new Date('2026-11-17T19:01:30Z')});
 });
 it('uses private credentials, documented nested customer, integer cents, metadata and original initialization idempotency',async()=>{
  const fetcher=vi.fn(async()=>Response.json({status:'success',data:{auth_type:'USSD',chapa_reference:'CH-original',payment_status:'PENDING',request_id:'req_original'}})),transport=createCurrentDirectTransport({env,fetcher});
  await transport.direct!({amountCents:'1250',merchantReference:'LW012345678901234567',idempotencyKey:'lowwin-direct-v5:'+key,paymentMethod:'telebirr',phone:'251900000000',metadata:{checkout_id:key}});
  const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.chapa.global/v2/payments/direct');
  expect(new Headers(request.headers).get('Authorization')).toBe('Bearer '+env.CHAPA_PRIVATE_KEY);expect(new Headers(request.headers).get('Idempotency-Key')).toBe('lowwin-direct-v5:'+key);
  expect(JSON.parse(String(request.body))).toEqual({amount:1250,currency:'ETB',merchant_reference:'LW012345678901234567',payment_method:'telebirr',customer:{phone_number:'251900000000'},metadata:{checkout_id:key}});
  expect(request.redirect).toBe('error');
 });
 it('authorizes only the original reference and method, keeps OTP transient and sends no initialization idempotency on validation',async()=>{
  const fetcher=vi.fn(async()=>Response.json({status:'success',data:{status:'PENDING'}})),transport=createCurrentDirectTransport({env,fetcher});
  await transport.validate!({reference:'CH-original',paymentMethod:'cbebirr',otp:'123456'});const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://api.chapa.global/v2/payments/direct/validate');expect(new Headers(request.headers).get('Idempotency-Key')).toBeNull();expect(new Headers(request.headers).get('Authorization')).toBe('Bearer '+env.CHAPA_PRIVATE_KEY);expect(JSON.parse(String(request.body))).toEqual({reference:'CH-original',payment_method:'cbebirr',otp:'123456'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it('does not require or send a public key for new Direct creation and rejects a public key in the private setting',()=>{
  expect(currentDirectAvailability(env)).toMatchObject({enabled:true,configured:true});expect(currentDirectAvailability({...env,CHAPA_PRIVATE_KEY:'CHAPA_TEST_PUB_'+'a'.repeat(40)})).toMatchObject({enabled:false,configured:false});
 });
 it('allows only an explicitly owned recovery operation when creation is paused',async()=>{
  const fetcher=vi.fn(async()=>Response.json({status:'success',data:{status:'PENDING'}})),transport=createCurrentDirectTransport({env:{...env,CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true'},fetcher});
  const request={amountCents:'1000',merchantReference:'LW012345678901234567',idempotencyKey:'lowwin-direct-v5:'+key,paymentMethod:'telebirr',phone:'251900000000'};
  await expect(transport.direct!(request)).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'});expect(fetcher).not.toHaveBeenCalled();
  await currentDirectEngineTransport(transport).inline(request,'recover');expect(fetcher).toHaveBeenCalledOnce();
 });
 it('recognizes only immutable Direct5 and current Inline4 for new state signals; historical Direct2 stays separate',()=>{
  expect(isCurrentDirectCheckout({flowVersion:5,initialization})).toBe(true);expect(isCurrentV2Checkout({flowVersion:5,initialization})).toBe(true);
  for(const order of [{flowVersion:2,initialization:{}},{flowVersion:4,initialization:{apiVersion:'v2',flowVersion:4,flow:'INLINE'}},{flowVersion:5,initialization:{...initialization,flow:'INLINE'}}])expect(isCurrentDirectCheckout(order)).toBe(false);
  expect(isCurrentV2Checkout({flowVersion:2,initialization:{chargeType:'DIRECT'}})).toBe(false);expect(chapaCurrentV2({apiVersion:'v2',flowVersion:5})).toBe(true);expect(chapaCurrentV2({apiVersion:'v2',flowVersion:2})).toBe(false);
 });
 it('keeps credential/environment binding and matches echoed Direct metadata without requiring optional provider echo',()=>{
  for(const [name,value]of Object.entries(env))vi.stubEnv(name,value);
  const order={flowVersion:5,initialization,mode:'test',credentialFingerprint:chapaHash(env.CHAPA_PRIVATE_KEY)};expect(currentDirectBinding(order)).toBe(true);expect(currentDirectBinding({...order,credentialFingerprint:'c'.repeat(64)})).toBe(false);expect(currentDirectBinding({...order,mode:'live'})).toBe(false);
  expect(matchesChapaMetadata(initialization,undefined,key)).toBe(true);expect(matchesChapaMetadata(initialization,{checkout_id:key},key)).toBe(true);expect(matchesChapaMetadata(initialization,{checkout_id:'other'},key)).toBe(false);
 });
 it('stores only an opaque protocol-tagged recovery pointer; previous Inline pointers retain their original owned URL',()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)},key:()=>null,get length(){return values.size}};
  expect(retainChapaRecoveryPointer(storage,'owner','topup',{version:1,key,protocol:'direct'})).toBe(true);const saved=readChapaRecoveryPointer(storage,'owner','topup')!;expect(chapaOriginalRecoveryUrl(saved.key,saved.protocol)).toBe('/api/payments/chapa/direct/current?key='+key);expect([...values.values()][0]).not.toMatch(/amount|phone|quote|token/);
  expect(chapaOriginalRecoveryUrl(key)).toBe('/api/payments/chapa/inline?key='+key);expect(chapaOriginalKeyUrl({key,apiVersion:'v2',kind:'direct',flow:'DIRECT',purpose:'TOP_UP',amount:'10',paymentMethod:'telebirr',phone:'251900000000'})).toBe('/api/payments/chapa/direct/current?key='+key);
  expect(retainChapaRecoveryPointer(storage,'owner','topup',{version:1,key,protocol:'inline'})).toBe(false);
 });
});
