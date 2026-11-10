import {afterEach,describe,expect,it,vi} from 'vitest';
import {createDirectMethodCatalog} from '../src/modules/payments/chapa-direct-methods';

const environment={APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/chapa_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',CHAPA_DIRECT_EBIRR_ENABLED:'false'};
const method=(slug:string,min=100,max=100000)=>({name:slug,slug,can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{countries:{ET:{is_enabled:true,min_amount:min,max_amount:max}}}}});
const response=(...methods:ReturnType<typeof method>[])=>({status:'success',data:methods});
const setup=()=>{for(const [key,value] of Object.entries(environment))vi.stubEnv(key,value);vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T09:00:00Z'))};
const deferred=()=>{let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(done=>{resolve=done});return {promise,resolve}};
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});

describe('direct method capability cache',()=>{
 it('shares one cold fetch, keeps warm capabilities, and filters every total against exact limits',async()=>{
  setup();const read=deferred(),methods=vi.fn(()=>read.promise),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  const requests=Array.from({length:20},(_,index)=>catalog.get(index%2?500n:100n));
  expect(methods).toHaveBeenCalledOnce();read.resolve(response(method('telebirr'),method('mpesa',500,1000)));
  const values=await Promise.all(requests);expect(values[0].map(value=>value.slug)).toEqual(['telebirr']);expect(values[1].map(value=>value.slug)).toEqual(['telebirr','mpesa']);
  expect((await catalog.get(1001n)).map(value=>value.slug)).toEqual(['telebirr']);expect(methods).toHaveBeenCalledOnce();
 });
 it('fails closed after expiration and retries a failed refresh without serving old capabilities',async()=>{
  setup();const methods=vi.fn().mockResolvedValueOnce(response(method('telebirr'))).mockRejectedValueOnce(Error('provider unavailable')).mockResolvedValueOnce(response(method('mpesa',500))),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  expect((await catalog.get()).map(value=>value.slug)).toEqual(['telebirr']);vi.advanceTimersByTime(300001);
  await expect(catalog.get()).rejects.toThrow('provider unavailable');expect((await catalog.get()).map(value=>value.slug)).toEqual(['mpesa']);expect(methods).toHaveBeenCalledTimes(3);
 });
 it('never caches malformed method responses or silently authorizes while disabled',async()=>{
  setup();const methods=vi.fn().mockResolvedValueOnce({status:'success',data:[{slug:'telebirr'}]}).mockResolvedValueOnce(response(method('telebirr'))),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  await expect(catalog.get()).rejects.toMatchObject({code:'METHODS_UNAVAILABLE'});await catalog.get();vi.stubEnv('CHAPA_ENABLED','false');await expect(catalog.get()).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'});expect(methods).toHaveBeenCalledTimes(2);
 });
 it('isolates warm merchant credentials and test/live capabilities',async()=>{
  setup();const methods=vi.fn().mockResolvedValueOnce(response(method('telebirr'))).mockResolvedValueOnce(response(method('mpesa',500))).mockResolvedValueOnce(response(method('cbebirr'))),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  await catalog.get();vi.stubEnv('CHAPA_PRIVATE_KEY','CHAPA_TEST_'+'b'.repeat(40));expect((await catalog.get()).map(value=>value.slug)).toEqual(['mpesa']);
  for(const [key,value] of Object.entries({APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'c'.repeat(40),CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',STAGING_DEMO_ENABLED:'false'}))vi.stubEnv(key,value);
  expect((await catalog.get()).map(value=>value.slug)).toEqual(['cbebirr']);expect(methods).toHaveBeenCalledTimes(3);
 });
 it('rejects an in-flight response after credentials change and does not replace the new cache',async()=>{
  setup();const old=deferred(),methods=vi.fn().mockImplementationOnce(()=>old.promise).mockResolvedValueOnce(response(method('mpesa',500))),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  const oldRequest=expect(catalog.get()).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});vi.stubEnv('CHAPA_PRIVATE_KEY','CHAPA_TEST_'+'b'.repeat(40));await catalog.get();old.resolve(response(method('telebirr')));await oldRequest;
  expect((await catalog.get()).map(value=>value.slug)).toEqual(['mpesa']);expect(methods).toHaveBeenCalledTimes(2);
 });
 it('binds opt-in capabilities to the original configuration, not a mutable response-time flag',async()=>{
  setup();const read=deferred(),methods=vi.fn().mockImplementationOnce(()=>read.promise).mockResolvedValueOnce(response(method('telebirr'),method('ebirr'))),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  const oldRequest=expect(catalog.get()).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});vi.stubEnv('CHAPA_DIRECT_EBIRR_ENABLED','true');read.resolve(response(method('telebirr'),method('ebirr')));await oldRequest;
  expect((await catalog.get()).map(value=>value.slug)).toEqual(['telebirr','ebirr']);expect(methods).toHaveBeenCalledTimes(2);
 });
 it('does not let an older same-key completion clear a newer single-flight request',async()=>{
  setup();const a1=deferred(),a2=deferred(),methods=vi.fn().mockImplementationOnce(()=>a1.promise).mockResolvedValueOnce(response(method('mpesa',500))).mockImplementationOnce(()=>a2.promise),catalog=createDirectMethodCatalog({create:vi.fn(),lookup:vi.fn(),methods});
  const first=catalog.get();vi.stubEnv('CHAPA_PRIVATE_KEY','CHAPA_TEST_'+'b'.repeat(40));await catalog.get();vi.stubEnv('CHAPA_PRIVATE_KEY',environment.CHAPA_PRIVATE_KEY);const second=catalog.get();
  a1.resolve(response(method('telebirr')));await first;const joined=catalog.get();expect(methods).toHaveBeenCalledTimes(3);
  a2.resolve(response(method('cbebirr')));expect((await second).map(value=>value.slug)).toEqual(['cbebirr']);expect((await joined).map(value=>value.slug)).toEqual(['cbebirr']);
 });
});
