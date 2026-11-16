import {describe,expect,it,vi} from 'vitest';
import {CHAPA_INLINE_MIGRATION,checkChapaInlineReadiness,type ChapaInlineSchemaSnapshot} from '../src/modules/payments/chapa-inline-readiness';

const env=(patch:Record<string,string|undefined>={})=>({APP_ENV:'production',NODE_ENV:'production',DATABASE_URL:'postgresql://private:private@database.example/private',MINI_APP_URL:'https://lowwin.shop',BETTER_AUTH_URL:'https://lowwin.shop',CHAPA_MODE:'live',CHAPA_SCHEMA_READY:'true',CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_LIVE_PUB_'+'b'.repeat(32),CHAPA_WEBHOOK_SECRET:'private-webhook-secret-at-least-thirty-two-characters',...patch});
const schema=(patch:Partial<ChapaInlineSchemaSnapshot>={}):ChapaInlineSchemaSnapshot=>({migrationApplied:true,identityConstraint:true,guardTrigger:true,reconcileIndex:true,...patch});

describe('redacted v2 Inline deployment readiness',()=>{
 it('supports current public-key format and stays offline unless schema reading is supplied',async()=>{const raw=env(),report=await checkChapaInlineReadiness(raw);expect(report).toMatchObject({apiVersion:'v2',configured:true,creationEnabled:true,recoveryEnabled:true,configuredMethods:['telebirr','cbebirr','mpesa'],missingPrerequisites:[],ready:true,schema:{status:'not-requested'}});const text=JSON.stringify(report);for(const value of [raw.DATABASE_URL,raw.MINI_APP_URL,raw.CHAPA_PRIVATE_KEY,raw.CHAPA_PUBLIC_KEY,raw.CHAPA_WEBHOOK_SECRET,'Fingerprint'])expect(text).not.toContain(value)});
 it('distinguishes a public key incorrectly stored as the private key',async()=>{expect(await checkChapaInlineReadiness(env({CHAPA_PRIVATE_KEY:'CHAPA_LIVE_PUB_'+'a'.repeat(32)}))).toMatchObject({ready:false,credentials:{privateKeyPresent:true,privateKeyIsPublic:true},missingPrerequisites:['CHAPA_PRIVATE_KEY']})});
 it.each([undefined,'CHAPUBK-'+'b'.repeat(32),'CHAPA_TEST_PUB_'+'b'.repeat(32)])('reports absent, old or wrong-environment public keys without echoing them',async key=>{expect(await checkChapaInlineReadiness(env({CHAPA_PUBLIC_KEY:key}))).toMatchObject({ready:false,credentials:{publicKeyValid:false},missingPrerequisites:['CHAPA_PUBLIC_KEY']})});
 it('keeps recovery independent of paused new creation',async()=>{expect(await checkChapaInlineReadiness(env({CHAPA_ENABLED:'false',CHAPA_INLINE_ENABLED:'false'}))).toMatchObject({creationEnabled:false,recoveryEnabled:true,ready:false,disabledCreationGates:['CHAPA_ENABLED','CHAPA_INLINE_ENABLED']})});
 it('reports only allowlisted method names',async()=>{const report=await checkChapaInlineReadiness(env({CHAPA_INLINE_METHODS:'telebirr,private-token,telebirr'}));expect(report.configuredMethods).toEqual(['telebirr']);expect(report.unrecognizedMethodsPresent).toBe(true);expect(JSON.stringify(report)).not.toContain('private-token')});
 it('never treats a historical CBE Bank flag as a supported new Inline method',async()=>{expect(await checkChapaInlineReadiness(env({CHAPA_INLINE_METHODS:''}))).toMatchObject({ready:false,configuredMethods:[]});expect(await checkChapaInlineReadiness(env({CHAPA_INLINE_METHODS:'',CHAPA_INLINE_CBE_BANK_ENABLED:'true'}))).toMatchObject({ready:false,configurationReady:false,cbeBankEnabled:false})});
 it('reports exact migration metadata after an explicitly requested read',async()=>{const read=vi.fn(async()=>schema());expect(await checkChapaInlineReadiness(env(),read)).toMatchObject({ready:true,schema:{expectedMigration:CHAPA_INLINE_MIGRATION,status:'ok',migrationApplied:true}});expect(read).toHaveBeenCalledOnce()});
 it('reports pending and incomplete schema state',async()=>{expect(await checkChapaInlineReadiness(env(),async()=>schema({migrationApplied:false}))).toMatchObject({ready:false,schema:{status:'pending'}});for(const patch of [{identityConstraint:false},{guardTrigger:false},{reconcileIndex:false}])expect(await checkChapaInlineReadiness(env(),async()=>schema(patch))).toMatchObject({ready:false,schema:{status:'incomplete'}})});
 it('does not echo database errors',async()=>{const raw=env(),report=await checkChapaInlineReadiness(raw,async()=>{throw Error(raw.DATABASE_URL)});expect(report).toMatchObject({ready:false,schema:{status:'unavailable'}});expect(JSON.stringify(report)).not.toContain(raw.DATABASE_URL)});
 it('distinguishes offline configuration readiness from provider connectivity',async()=>{
  expect(await checkChapaInlineReadiness(env())).toMatchObject({ready:true,configurationReady:true,providerConnectivity:'not-checked',methods:{status:'not-requested'}});
  const fetcher=vi.fn<typeof fetch>();expect(await checkChapaInlineReadiness(env(),undefined,{methods:true,fetcher})).toMatchObject({ready:false,configurationReady:true,providerConnectivity:'blocked',methods:{status:'blocked'}});expect(fetcher).not.toHaveBeenCalled();
 });
 it('reports a sanitized TEST environment rejection without changing configured state',async()=>{
  const raw=env({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:5432/test',CHAPA_MODE:'test',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32)});
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({status:'error',message:'API key environment does not match business environment.',error:{code:'INVALID_VALUE',details:null}},{status:403}));
  const report=await checkChapaInlineReadiness(raw,undefined,{methods:true,fetcher});
  expect(report).toMatchObject({configured:true,configurationReady:true,ready:false,providerConnectivity:'unavailable',methods:{status:'unavailable',provider:{httpStatus:403,code:'INVALID_VALUE',diagnostic:{code:'ENVIRONMENT_MISMATCH',message:'API key environment does not match business environment.'}}}});
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toBe('https://api.chapa.global/v2/payments/methods');
  const serialized=JSON.stringify(report);expect(serialized).not.toContain(raw.CHAPA_PRIVATE_KEY);expect(serialized).not.toContain(raw.CHAPA_PUBLIC_KEY);
 });
 it('limits successful TEST discovery to configured enabled ETB/ET checkout rails',async()=>{
  const raw=env({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:5432/test',CHAPA_MODE:'test',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32)});
  const method=(slug:string)=>({name:slug,slug,can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:10000,countries:{ET:{is_enabled:true}}}}});
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({status:'success',data:[method('telebirr'),method('mpesa'),method('awashbirr'),method('ebirr')]}));
  expect(await checkChapaInlineReadiness(raw,undefined,{methods:true,fetcher})).toMatchObject({ready:true,providerConnectivity:'reachable',methods:{status:'ok',items:[{slug:'telebirr'},{slug:'mpesa'}]}});
 });
});
