import {describe,expect,it,vi} from 'vitest';
import {createChapaMethodCatalog} from '../src/modules/payments/chapa-methods';
import type {ChapaTransport} from '../src/modules/payments/chapa-provider';

const environment=(change:Record<string,string|undefined>={})=>({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/chapa_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',CHAPA_PREFERRED_PAYMENT_METHODS:'telebirr',...change});
const method=(slug:string,min=100,max=100000)=>({name:slug,slug,can_process_payments:true,supported_currencies:{ETB:{default_min:min,default_max:max,countries:{ET:{is_enabled:true}}}}});
function transport(data:unknown={status:'success',data:[method('awashbirr'),method('telebirr'),method('cbebirr')]}){return {create:vi.fn(),lookup:vi.fn(),methods:vi.fn(async()=>data)} satisfies ChapaTransport}

describe('opt-in Chapa merchant method preferences',()=>{
 it('keeps minimal checkout defaults and does not fetch when empty or disabled',async()=>{
  const catalog=createChapaMethodCatalog(),t=transport();
  for(const change of [{CHAPA_PREFERRED_PAYMENT_METHODS:''},{CHAPA_ENABLED:'false'},{CHAPA_PREFERRED_PAYMENT_METHODS:'telebirr,../private'}]){
   const env=environment(change);await catalog.refresh(env,t);expect(catalog.preferences(1000n,env)).toBeUndefined();
  }
  expect(t.methods).not.toHaveBeenCalled();expect(t.create).not.toHaveBeenCalled();
 });
 it('uses only actual enabled ETB/ET rails within amount limits and keeps alternatives after Telebirr',async()=>{
  const catalog=createChapaMethodCatalog(),env=environment(),t=transport({status:'success',data:[method('awashbirr'),method('telebirr'),method('cbebirr'),{...method('disabled'),can_process_payments:false},{...method('other-country'),supported_currencies:{ETB:{countries:{KE:{is_enabled:true}},default_min:100,default_max:100000}}},method('large-only',5000)]});
  expect(catalog.preferences(1000n,env)).toBeUndefined();await catalog.refresh(env,t);
  expect(catalog.preferences(1000n,env)).toEqual({preferredPaymentMethods:['telebirr','awashbirr','cbebirr'],preferredPaymentMethodsVersion:1});
  expect(catalog.preferences(1000000n,env)).toBeUndefined();
  expect(t.methods).toHaveBeenCalledTimes(1);expect(t.create).not.toHaveBeenCalled();
 });
 it('does not invent CBE or hide alternatives when a requested slug is not merchant-enabled',async()=>{
  const catalog=createChapaMethodCatalog(),env=environment({CHAPA_PREFERRED_PAYMENT_METHODS:'cbe'}),t=transport();await catalog.refresh(env,t);
  expect(catalog.preferences(1000n,env)).toBeUndefined();
 });
 it('honors the observed merchant country overrides and Telebirr/CBEbirr priority at each amount',async()=>{
  const rail=(slug:string,min:number,max:number)=>({...method(slug),supported_currencies:{ETB:{default_min:100,default_max:100000,countries:{ET:{is_enabled:true,min_amount:min,max_amount:max}}}}});
  const catalog=createChapaMethodCatalog(),env=environment({CHAPA_PREFERRED_PAYMENT_METHODS:'telebirr,cbebirr,mpesa,awashbirr'});
  const t=transport({status:'success',data:[rail('awashbirr',1000,10000000),rail('mpesa',500,100000000),rail('telebirr',100,100000000),rail('cbebirr',100,100000000)]});
  await catalog.refresh(env,t);
  expect(catalog.preferences(100n,env)?.preferredPaymentMethods).toEqual(['telebirr','cbebirr']);
  expect(catalog.preferences(500n,env)?.preferredPaymentMethods).toEqual(['telebirr','cbebirr','mpesa']);
  expect(catalog.preferences(1000n,env)?.preferredPaymentMethods).toEqual(['telebirr','cbebirr','mpesa','awashbirr']);
  expect(catalog.preferences(100001n,env)?.preferredPaymentMethods).toContain('awashbirr');
  expect(catalog.preferences(10000001n,env)?.preferredPaymentMethods).toEqual(['telebirr','cbebirr','mpesa']);
 });
 it('deduplicates concurrent catalog reads and only re-fetches after the bounded TTL',async()=>{
  let now=0;const catalog=createChapaMethodCatalog(()=>now),env=environment(),t=transport();
  await Promise.all([catalog.refresh(env,t),catalog.refresh(env,t)]);await catalog.refresh(env,t);expect(t.methods).toHaveBeenCalledTimes(1);
  now=5*60000+1;expect(catalog.preferences(1000n,env)).toBeUndefined();await catalog.refresh(env,t);expect(t.methods).toHaveBeenCalledTimes(2);
 });
 it('isolates merchant credentials and mode instead of reusing another catalog',async()=>{
  const catalog=createChapaMethodCatalog(),env=environment(),t=transport();await catalog.refresh(env,t);
  expect(catalog.preferences(1000n,environment({CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'b'.repeat(40)}))).toBeUndefined();
  expect(catalog.preferences(1000n,environment({CHAPA_MODE:'live'}))).toBeUndefined();
 });
 it('falls back to minimal requests after errors and bounds retries without permanent rejection',async()=>{
  let now=0;const catalog=createChapaMethodCatalog(()=>now),env=environment(),t=transport();
  t.methods.mockRejectedValueOnce(Error('provider unavailable'));await catalog.refresh(env,t);expect(catalog.preferences(1000n,env)).toBeUndefined();
  await catalog.refresh(env,t);expect(t.methods).toHaveBeenCalledTimes(1);now=30001;await catalog.refresh(env,t);
  expect(catalog.preferences(1000n,env)?.preferredPaymentMethods[0]).toBe('telebirr');expect(t.methods).toHaveBeenCalledTimes(2);
 });
 it('bounds the request without cutting off enabled merchant alternatives',async()=>{
  const catalog=createChapaMethodCatalog(),env=environment(),t=transport({status:'success',data:[method('telebirr'),...Array.from({length:10},(_,i)=>method(`rail-${i}`))]});
  await catalog.refresh(env,t);expect(catalog.preferences(1000n,env)).toBeUndefined();
 });
});
