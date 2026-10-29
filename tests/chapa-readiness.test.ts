import {describe,expect,it,vi} from 'vitest';
import {checkChapaReadiness,chapaReadinessPassed,chapaWorkerConfiguration} from '../src/modules/payments/chapa-readiness';

function environment(patch:Record<string,string|undefined>={}){
 return {APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://private-user:private-password@127.0.0.1:5432/readiness_test',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_SCHEMA_READY:'true',CHAPA_MODE:'test',CHAPA_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_WEBHOOK_SECRET:'private-webhook-secret-at-least-thirty-two-characters',...patch};
}
const method=()=>({name:'Untrusted provider display name',slug:'telebirr',is_mobile_money:true,can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:1000000,countries:{ET:{is_enabled:true,min_amount:250,max_amount:500000}}}}});

describe('non-charging Chapa readiness',()=>{
 it('identifies a disabled worker without requiring a running container or enabling new checkouts',()=>{
  const raw=environment({CHAPA_ENABLED:'false',CHAPA_LEGACY_SWEEP_ENABLED:'false'});
  expect(chapaWorkerConfiguration(raw)).toMatchObject({event:'chapa_worker_configuration',configured:true,recoveryEnabled:false,legacySweepEnabled:false,missingPrerequisites:['CHAPA_RECOVERY_ENABLED']});
  expect(chapaWorkerConfiguration({...raw,CHAPA_RECOVERY_ENABLED:'true'})).toMatchObject({configured:true,recoveryEnabled:true,legacySweepEnabled:false,missingPrerequisites:[]});
  expect(raw.CHAPA_ENABLED).toBe('false');
 });
 it('reports malformed Basic credentials without logging any credential or connection value',()=>{
  const raw:Record<string,string|undefined>=environment({CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true',CHAPA_WEBHOOK_AUTH:'basic',CHAPA_WEBHOOK_BASIC_USERNAME:'lowwin-webhook',CHAPA_WEBHOOK_BASIC_PASSWORD:'short-password'});
  const report=chapaWorkerConfiguration(raw);
  expect(report).toMatchObject({configured:false,recoveryEnabled:false,missingPrerequisites:['CHAPA_WEBHOOK_AUTH / BASIC credentials']});
  for(const secret of [raw.CHAPA_PRIVATE_KEY,raw.CHAPA_WEBHOOK_SECRET,raw.CHAPA_WEBHOOK_BASIC_USERNAME,raw.CHAPA_WEBHOOK_BASIC_PASSWORD,raw.DATABASE_URL,raw.MINI_APP_URL])if(secret)expect(JSON.stringify(report)).not.toContain(secret);
 });
 it('allows Basic Auth event processing without an unused signature secret and still rejects missing Basic credentials',async()=>{
  const raw=environment({CHAPA_WEBHOOK_SECRET:undefined,CHAPA_WEBHOOK_AUTH:'basic',CHAPA_WEBHOOK_BASIC_USERNAME:'lowwin-webhook',CHAPA_WEBHOOK_BASIC_PASSWORD:'b'.repeat(16),CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true'});
  expect(await checkChapaReadiness(raw)).toMatchObject({configured:true,creationEnabled:false,recoveryEnabled:true,missingPrerequisites:[]});
  expect(await checkChapaReadiness({...raw,CHAPA_WEBHOOK_BASIC_PASSWORD:''})).toMatchObject({configured:false,recoveryEnabled:false,missingPrerequisites:['CHAPA_WEBHOOK_AUTH / BASIC credentials']});
 });
 it('reports missing prerequisites using static names without connecting or disclosing input',async()=>{
  const fetcher=vi.fn<typeof fetch>(),readSchema=vi.fn(),raw=environment({CHAPA_PRIVATE_KEY:'malformed-private-key',CHAPA_WEBHOOK_SECRET:'short-secret',CHAPA_SCHEMA_READY:'false',MINI_APP_URL:'https://private-origin.invalid',DATABASE_URL:'postgresql://private-user:private-password@unreviewed.invalid/private-db'});
  const result=await checkChapaReadiness(raw,{}, {fetcher,readSchema});
  expect(result).toMatchObject({mode:'test',configured:false,creationEnabled:false,recoveryEnabled:false,schema:{status:'not-requested'},methods:{status:'not-requested'}});
  expect(result.missingPrerequisites).toEqual(expect.arrayContaining(['CHAPA_PRIVATE_KEY','CHAPA_WEBHOOK_SECRET','CHAPA_SCHEMA_READY','MINI_APP_URL / BETTER_AUTH_URL','CHAPA_TEST_ENVIRONMENT_REVIEWED']));
  expect(result.missingPrerequisites).toContain('APP_ENV');
  const serialized=JSON.stringify(result);for(const secret of [raw.CHAPA_PRIVATE_KEY,raw.CHAPA_WEBHOOK_SECRET,raw.DATABASE_URL,raw.MINI_APP_URL,'credentialFingerprint'])expect(serialized).not.toContain(secret);
  expect(fetcher).not.toHaveBeenCalled();expect(readSchema).not.toHaveBeenCalled();expect(chapaReadinessPassed(result)).toBe(false);
 });
 it('keeps a configured paused integration offline and distinguishes configuration from activation',async()=>{
  const fetcher=vi.fn<typeof fetch>(),readSchema=vi.fn(),raw=environment({CHAPA_ENABLED:'false'}),before={...raw};
  const result=await checkChapaReadiness(raw,{}, {fetcher,readSchema});
  expect(result).toMatchObject({configured:true,creationEnabled:false,recoveryEnabled:false,missingPrerequisites:[]});
  expect(chapaReadinessPassed(result)).toBe(true);expect(raw).toEqual(before);expect(fetcher).not.toHaveBeenCalled();expect(readSchema).not.toHaveBeenCalled();
 });
 it('blocks all optional checks for LIVE even when the live integration is configured',async()=>{
  const fetcher=vi.fn<typeof fetch>(),readSchema=vi.fn(),raw=environment({APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'b'.repeat(32),CHAPA_LIVE_ENABLED:'true',CHAPA_MERCHANT_REVIEWED:'true'});
  const result=await checkChapaReadiness(raw,{schema:true,methods:true},{fetcher,readSchema});
  expect(result).toMatchObject({mode:'live',configured:true,creationEnabled:true,schema:{status:'blocked'},methods:{status:'blocked'}});
  expect(fetcher).not.toHaveBeenCalled();expect(readSchema).not.toHaveBeenCalled();expect(chapaReadinessPassed(result)).toBe(false);
 });
 it.each([
  {CHAPA_SCHEMA_READY:'false'},{CHAPA_PRIVATE_KEY:undefined},{CHAPA_MODE:'invalid'},
  {APP_ENV:'production'},{VERCEL_ENV:'production'},
  {APP_ENV:'staging',DATABASE_URL:'postgresql://private:private@remote.invalid/test'},
 ])('does not query unreviewed or incomplete TEST configuration: %o',async patch=>{
  const fetcher=vi.fn<typeof fetch>(),readSchema=vi.fn();
  const result=await checkChapaReadiness(environment(patch),{schema:true,methods:true},{fetcher,readSchema});
  expect(result.schema.status).toBe('blocked');expect(result.methods.status).toBe('blocked');expect(fetcher).not.toHaveBeenCalled();expect(readSchema).not.toHaveBeenCalled();
 });
 it('requires the existing creation gate for method discovery and never overrides it',async()=>{
  const fetcher=vi.fn<typeof fetch>(),raw=environment({CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true'});
  expect((await checkChapaReadiness(raw,{methods:true},{fetcher})).methods.status).toBe('blocked');
  expect(fetcher).not.toHaveBeenCalled();expect(raw.CHAPA_ENABLED).toBe('false');
 });
 it('uses only the existing TEST GET-methods transport and outputs an allowlisted projection',async()=>{
  const raw=environment(),fetcher=vi.fn<typeof fetch>(async()=>Response.json({status:'success',data:[{...method(),name:raw.CHAPA_PRIVATE_KEY,private:raw.CHAPA_WEBHOOK_SECRET},{...method(),slug:'disabled',can_process_payments:false}]}));
  const result=await checkChapaReadiness(raw,{methods:true},{fetcher});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual(['https://api.chapa.global/v2/payments/methods',expect.objectContaining({method:'GET',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+raw.CHAPA_PRIVATE_KEY}})]);
  expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  expect(result.methods).toEqual({status:'ok',items:[{slug:'telebirr',minimumCents:'250',maximumCents:'500000',isMobileMoney:true}]});
  const serialized=JSON.stringify(result);expect(serialized).not.toContain(raw.CHAPA_PRIVATE_KEY);expect(serialized).not.toContain(raw.CHAPA_WEBHOOK_SECRET);expect(serialized).not.toContain('credentialFingerprint');expect(chapaReadinessPassed(result)).toBe(true);
 });
 it('reports an empty enabled-method list without inventing merchant capabilities',async()=>{
  const result=await checkChapaReadiness(environment(),{methods:true},{fetcher:vi.fn(async()=>Response.json({status:'success',data:[]}))});
  expect(result.methods).toEqual({status:'ok',items:[]});
 });
 it('permits only explicit read-only schema checks and reports counts instead of receipt details',async()=>{
  const raw=environment({CHAPA_ENABLED:'false'}),readSchema=vi.fn(async()=>({driftCount:0}));
  expect((await checkChapaReadiness(raw,{schema:true},{readSchema})).schema).toEqual({status:'ok',driftCount:0});expect(readSchema).toHaveBeenCalledTimes(1);
  readSchema.mockResolvedValueOnce({driftCount:2});const drift=await checkChapaReadiness(raw,{schema:true},{readSchema});
  expect(drift.schema).toEqual({status:'drift',driftCount:2});expect(chapaReadinessPassed(drift)).toBe(false);
 });
 it('uses the reviewed TEST configuration snapshot across asynchronous checks',async()=>{
  const raw=environment({APP_ENV:'staging',DATABASE_URL:'postgresql://private:private@reviewed.invalid/test',CHAPA_TEST_ENVIRONMENT_REVIEWED:'true'});
  const originalKey=raw.CHAPA_PRIVATE_KEY,fetcher=vi.fn<typeof fetch>(async()=>Response.json({status:'success',data:[method()]}));
  const readSchema=vi.fn(async()=>{raw.CHAPA_PRIVATE_KEY='CHAPA_LIVE_'+'b'.repeat(32);raw.CHAPA_MODE='live';return {driftCount:0}});
  const result=await checkChapaReadiness(raw,{schema:true,methods:true},{readSchema,fetcher});
  expect(result).toMatchObject({mode:'test',schema:{status:'ok'},methods:{status:'ok'}});
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',headers:{Authorization:'Bearer '+originalKey}});
 });
 it('sanitizes database, network and provider-shape failures without exposing errors',async()=>{
  const raw=environment(),readSchema=vi.fn(async()=>{throw Error(raw.DATABASE_URL)});
  for(const fetcher of [vi.fn(async()=>{throw Error(raw.CHAPA_PRIVATE_KEY)}),vi.fn(async()=>Response.json({status:'success',data:{private:raw.CHAPA_WEBHOOK_SECRET}}))]){
   const result=await checkChapaReadiness(raw,{schema:true,methods:true},{readSchema,fetcher});
   expect(result.schema).toEqual({status:'unavailable'});expect(result.methods).toEqual({status:'unavailable'});
   const serialized=JSON.stringify(result);for(const secret of [raw.DATABASE_URL,raw.CHAPA_PRIVATE_KEY,raw.CHAPA_WEBHOOK_SECRET])expect(serialized).not.toContain(secret);
   expect(chapaReadinessPassed(result)).toBe(false);
  }
 });
});
