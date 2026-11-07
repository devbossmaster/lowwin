import {afterEach,describe,expect,it,vi} from 'vitest';
import {createChapaTransport,createdChapaDirect} from '../src/modules/payments/chapa-provider';
import {parseDirectMethods,createDirectMethodCatalog} from '../src/modules/payments/chapa-direct-methods';
import {normalizePaymentPhone} from '../src/modules/payments/chapa-direct';
import {normalizeBatchNumbers,batchChildKey} from '../src/modules/auctions/batch';
import {chapaHttpError} from '../src/modules/payments/chapa-http';

const environment={APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/chapa_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test'};
const method=(slug:string,min=100,max=100000)=>({name:slug,slug,can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:100000,countries:{ET:{is_enabled:true,min_amount:min,max_amount:max}}}}});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});
describe('direct-charge contracts and exact batch amounts',()=>{
 it('normalizes equivalent decimals, rejects duplicate and excess precision, and keeps display order',()=>{
  expect(normalizeBatchNumbers(['2','1.01','3.4'])).toEqual(['2.00','1.01','3.40']);
  expect(()=>normalizeBatchNumbers(['2','2.00'])).toThrow('different');expect(()=>normalizeBatchNumbers(['1.001'])).toThrow();
  expect(batchChildKey('f81ebd91-4654-47c3-979f-937612993a1d',0)).toMatch(/^[a-f0-9-]{36}$/);expect(batchChildKey('batch',0)).toBe(batchChildKey('batch',0));expect(batchChildKey('batch',0)).not.toBe(batchChildKey('batch',1));
 });
 it('normalizes editable Ethiopian phones without a duplicated national zero',()=>{for(const raw of ['0911652904','+251911652904','251911652904','911652904'])expect(normalizePaymentPhone(raw)).toBe('251911652904');for(const raw of ['+2510911652904','+15555555555','911','hello'])expect(()=>normalizePaymentPhone(raw)).toThrow()});
 it('strictly allowlists enabled direct ETB/ET capabilities in the requested priority',()=>{
  const data=[method('awashbirr'),method('cbebirr'),method('mpesa',500),method('telebirr'),method('ebirr'),method('bank'),{...method('telebirr'),can_process_direct_charge:false}];
  expect(parseDirectMethods({status:'success',data})?.map(m=>m.slug)).toEqual(['telebirr','mpesa','cbebirr']);
  expect(parseDirectMethods({status:'success',data},true)?.map(m=>m.slug)).toEqual(['telebirr','mpesa','cbebirr','ebirr']);
  expect(parseDirectMethods({status:'success',data:[{...method('telebirr'),can_process_direct_charge:false}]})).toEqual([]);
  expect(parseDirectMethods({status:'success',data:[{...method('telebirr'),supported_currencies:{ETB:{countries:{ET:{is_enabled:false}},default_min:100,default_max:10000}}}]})).toEqual([]);
 });
 it('deduplicates capability reads, filters exact country limits and isolates credentials',async()=>{
  for(const [key,value] of Object.entries(environment))vi.stubEnv(key,value);
  const methods=vi.fn(async()=>({status:'success',data:[method('telebirr'),method('mpesa',500)]})),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  expect((await Promise.all([catalog.get(100n),catalog.get(100n)]))[0].map(m=>m.slug)).toEqual(['telebirr']);expect(methods).toHaveBeenCalledOnce();
  vi.stubEnv('CHAPA_PRIVATE_KEY','CHAPA_TEST_'+'b'.repeat(40));await catalog.get();expect(methods).toHaveBeenCalledTimes(2);
  methods.mockRejectedValueOnce(Error('unavailable'));vi.stubEnv('CHAPA_PRIVATE_KEY','CHAPA_TEST_'+'c'.repeat(40));await expect(catalog.get()).rejects.toThrow();
 });
 it('uses only official direct and validate endpoints, stable initialization key, and no PIN fields',async()=>{
  const fetcher=vi.fn(async()=>Response.json({status:'success',data:{}})),transport=createChapaTransport({env:environment,fetcher});
  const charge={amountCents:'15000',merchantReference:'LWexample',idempotencyKey:'operation-key-original-123',paymentMethod:'telebirr',phone:'251911652904'};
  await transport.direct!(charge);await transport.direct!(charge);await transport.validate!({reference:'CHpaid',paymentMethod:'telebirr'});await transport.validate!({reference:'CHotp',paymentMethod:'cbebirr',otp:'123456'});
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
  expect(calls.map(c=>new URL(c[0]).pathname)).toEqual(['/v2/payments/direct','/v2/payments/direct','/v2/payments/direct/validate','/v2/payments/direct/validate']);
  expect(calls[0][1].body).toBe(calls[1][1].body);expect((calls[0][1].headers as Record<string,string>)['Idempotency-Key']).toBe(charge.idempotencyKey);
  expect(JSON.parse(String(calls[0][1].body))).toEqual({amount:15000,currency:'ETB',merchant_reference:'LWexample',payment_method:'telebirr',customer:{phone_number:'251911652904'}});
  expect(JSON.parse(String(calls[2][1].body))).toEqual({reference:'CHpaid',payment_method:'telebirr'});expect(JSON.parse(String(calls[3][1].body))).toEqual({reference:'CHotp',payment_method:'cbebirr',otp:'123456'});
 });
 it('does not confuse direct initialization operation success with paid status',()=>{expect(createdChapaDirect({status:'success',data:{auth_type:'USSD',chapa_reference:'CHone',request_id:'request-one',payment_status:'PENDING'}})).toMatchObject({authType:'USSD',reference:'CHone'});expect(createdChapaDirect({status:'success',data:{auth_type:'PIN',chapa_reference:'CHone',request_id:'request-one',payment_status:'SUCCESS'}})).toBeNull()});
 it('surfaces only exact structured provider authorization reasons without raw details or inferred insufficient funds',async()=>{
  const transport=createChapaTransport({env:environment,fetcher:vi.fn(async()=>Response.json({status:'error',message:'Sensitive bank text 251911652904',error:{code:'INVALID_OTP',details:{phone:'251911652904',otp:'123456'}}},{status:400}))});
  let response:Response|undefined;try{await transport.validate!({reference:'CHotp',paymentMethod:'telebirr',otp:'123456'})}catch(error){response=chapaHttpError(error)}expect(response?.status).toBe(422);const body=await response!.json();expect(body.code).toBe('INVALID_OTP');expect(JSON.stringify(body)).not.toMatch(/251911652904|123456|Sensitive/);
  const unavailable=createChapaTransport({env:environment,fetcher:vi.fn(async()=>Response.json({status:'error',message:'insufficient funds',error:{code:'PROCESSING_FAILED'}},{status:500}))});try{await unavailable.validate!({reference:'CHunknown',paymentMethod:'telebirr'})}catch(error){const failed=await chapaHttpError(error).json();expect(failed.code).toBe('PROVIDER_UNAVAILABLE');expect(failed.error).not.toContain('insufficient')}
 });
});
