import {afterEach,describe,expect,it,vi} from 'vitest';
import {chapaHash,ChapaProviderError,type ChapaTransport} from '../src/modules/payments/chapa-provider';
import {chapaInlineAvailability,chapaInlineConfiguredMethods,chapaInlinePublicKeyValid,createChapaInlineTransport,createInlineMethodCatalog,inlineTransportBinding,isV2InlineCheckout} from '../src/modules/payments/chapa-inline-provider';

const environment=(patch:Record<string,string|undefined>={})=>({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_inline_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_ENABLED:'true',CHAPA_INLINE_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32),CHAPA_WEBHOOK_SECRET:'local-inline-webhook-secret-at-least-thirty-two-characters',...patch});
const request={amountCents:'5025',merchantReference:'LW123456789012345678',idempotencyKey:'lowwin-inline:12345678-1234-1234-1234-123456789012',paymentMethod:'telebirr',phone:'251911652904'};
const capabilities=(slug='telebirr',minimum=100,maximum=100000)=>({status:'success',data:[{slug,name:slug,can_process_payments:true,supported_currencies:{ETB:{default_min:1,default_max:100000,countries:{ET:{is_enabled:true,min_amount:minimum,max_amount:maximum}}}}}]});
afterEach(()=>vi.useRealTimers());

describe('documented v2 public Inline boundary',()=>{
 it('recognizes matching public keys and requires independently configured private verification',()=>{
  expect(chapaInlineAvailability(environment())).toMatchObject({configured:true,enabled:true,recoveryEnabled:true,publicKeyValid:true,privateKeyIsPublic:false});
  expect(chapaInlineAvailability(environment({CHAPA_PRIVATE_KEY:'CHAPA_TEST_PUB_'+'b'.repeat(32)}))).toMatchObject({configured:false,enabled:false,privateKeyIsPublic:true});
  for(const CHAPA_PUBLIC_KEY of ['CHAPUBK_TEST-'+'b'.repeat(32),'CHAPA_LIVE_PUB_'+'b'.repeat(32),'CHAPA_TEST_'+'b'.repeat(32),'CHAPA_TEST_PUB_CHANGE_ME'])expect(chapaInlineAvailability(environment({CHAPA_PUBLIC_KEY})).configured).toBe(false);
 });
 it('allows live Inline only with matching environments and explicit review/activation',()=>{
  const live={APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'a'.repeat(32),CHAPA_PUBLIC_KEY:'CHAPA_LIVE_PUB_'+'b'.repeat(32),CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true'};
  expect(chapaInlineAvailability(environment(live)).enabled).toBe(true);
  expect(chapaInlineAvailability(environment({...live,CHAPA_LIVE_ENABLED:'false'})).enabled).toBe(false);
  expect(chapaInlinePublicKeyValid(live.CHAPA_PUBLIC_KEY,'test')).toBe(false);
 });
 it('keeps original public authorization available while new Inline preparation is paused',()=>{
  expect(chapaInlineAvailability(environment({CHAPA_INLINE_ENABLED:'false'}))).toMatchObject({configured:true,enabled:false,recoveryEnabled:true});
  expect(chapaInlineAvailability(environment({CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true',CHAPA_INLINE_ENABLED:'false'}))).toMatchObject({enabled:false,recoveryEnabled:true});
 });
 it('requires both server-owned version markers and binds public/private account credentials',()=>{
  const raw=environment(),order={flowVersion:4,mode:'test',credentialFingerprint:chapaHash(raw.CHAPA_PRIVATE_KEY),initialization:{apiVersion:'v2',flowVersion:4,flow:'INLINE',publicKeyFingerprint:chapaHash(raw.CHAPA_PUBLIC_KEY)}};
  expect(isV2InlineCheckout(order)).toBe(true);expect(inlineTransportBinding(order,raw)).toBe(true);
  expect(inlineTransportBinding(order,{...raw,CHAPA_PUBLIC_KEY:'CHAPA_TEST_PUB_'+'c'.repeat(32)})).toBe(false);
  expect(inlineTransportBinding(order,{...raw,CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'d'.repeat(32)})).toBe(false);
  expect(isV2InlineCheckout({...order,flowVersion:2})).toBe(false);expect(isV2InlineCheckout({...order,initialization:{apiVersion:'v2'}})).toBe(false);
 });
 it('sends public-key v2 initialization in exact integer cents with stable idempotency',async()=>{
  const raw=environment(),fetcher=vi.fn(async()=>Response.json({status:'success',data:{}})),transport=createChapaInlineTransport({env:raw,fetcher:fetcher as typeof fetch});
  await transport.inline(request);await transport.inline(request,'recover');
  for(const [url,options] of fetcher.mock.calls as unknown as [string,RequestInit][]){expect(url).toBe('https://api.chapa.global/v2/payments/inline');expect(options.headers).toMatchObject({Authorization:'Bearer '+raw.CHAPA_PUBLIC_KEY,'Idempotency-Key':request.idempotencyKey});expect(options.redirect).toBe('error');expect(JSON.parse(options.body as string)).toEqual({amount:5025,currency:'ETB',merchant_reference:request.merchantReference,payment_method:'telebirr',mobile:request.phone});expect(options.body).not.toContain(raw.CHAPA_PRIVATE_KEY)}
 });
 it('validates USSD and provider-requested OTP without accepting any PIN field',async()=>{
  const raw=environment(),fetcher=vi.fn(async()=>Response.json({status:'success',data:{}})),transport=createChapaInlineTransport({env:raw,fetcher:fetcher as typeof fetch});
  await transport.validate!({reference:'CHref',paymentMethod:'telebirr'});await transport.validate!({reference:'CHref',paymentMethod:'cbebirr',otp:'123456'});
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
  expect(calls[0][0]).toBe('https://api.chapa.global/v2/payments/inline/validate');expect(JSON.parse(calls[0][1].body as string)).toEqual({reference:'CHref',payment_method:'telebirr'});expect(calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  expect(JSON.parse(calls[1][1].body as string)).toEqual({reference:'CHref',payment_method:'cbebirr',otp:'123456'});
  expect(()=>transport.validate!({reference:'CHref',paymentMethod:'telebirr',pin:'1234'} as never)).toThrow();
 });
 it('keeps private verification, method reads and hosted initialization on existing private transport',async()=>{
  const raw=environment(),fetcher=vi.fn(async()=>Response.json({status:'success',data:{}})),transport=createChapaInlineTransport({env:raw,fetcher:fetcher as typeof fetch});
  await transport.lookup('LWref');await transport.methods();await transport.create({amountCents:'5025',merchantReference:request.merchantReference,idempotencyKey:request.idempotencyKey,returnUrl:'https://lowwin.test/return',returnUrlVersion:1});
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];expect(calls.map(([url])=>url)).toEqual(['https://api.chapa.global/v2/payments/LWref/verify','https://api.chapa.global/v2/payments/methods','https://api.chapa.global/v2/payments/hosted']);for(const [,options] of calls)expect(options.headers).toMatchObject({Authorization:'Bearer '+raw.CHAPA_PRIVATE_KEY});
 });
 it('maps structured error codes without returning raw provider messages or payer data',async()=>{
  const transport=createChapaInlineTransport({env:environment(),fetcher:vi.fn(async()=>Response.json({status:'error',message:'private payer 251911652904 secret-value',error:{code:'INVALID_FORMAT',details:{phone:'251911652904'}}},{status:400})) as typeof fetch});
  await expect(transport.inline(request)).rejects.toMatchObject({providerCode:'INVALID_FORMAT',category:'request',httpStatus:400});
  try{await transport.inline(request)}catch(error){expect(error).toBeInstanceOf(ChapaProviderError);expect((error as Error).message).not.toContain('251911652904');expect((error as Error).message).not.toContain('secret-value')}
 });
 it('does not turn an interrupted response into a confirmed provider failure',async()=>{
  const transport=createChapaInlineTransport({env:environment(),fetcher:vi.fn(async()=>{throw new TypeError('network interrupted')}) as typeof fetch});
  await expect(transport.inline(request)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 });
 it('rejects unsupported methods, noninteger cents and excessive references before dispatch',()=>{
  const fetcher=vi.fn(),transport=createChapaInlineTransport({env:environment(),fetcher:fetcher as typeof fetch});
  for(const change of [{amountCents:'50.25'},{amountCents:'99'},{merchantReference:'x'.repeat(21)},{paymentMethod:'unknown'},{phone:'0911652904'}])expect(()=>transport.inline({...request,...change})).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 });
});
describe('Inline merchant capabilities cache',()=>{
 it('filters supported merchant-enabled ETB/ET methods without requiring Direct Charge capability',async()=>{
  const raw=environment(),methods=vi.fn(async()=>capabilities()),catalog=createInlineMethodCatalog({methods} as unknown as ChapaTransport,raw);
  expect(await catalog.get()).toMatchObject([{slug:'telebirr',minimumCents:'100',maximumCents:'100000'}]);
  expect(await catalog.get(99n)).toEqual([]);expect(methods).toHaveBeenCalledOnce();
 });
 it('deduplicates cold reads and refuses stale capabilities after public-key rotation',async()=>{
  const raw=environment();let resolve!:(value:unknown)=>void;const methods=vi.fn(()=>new Promise<unknown>(done=>{resolve=done})),catalog=createInlineMethodCatalog({methods} as unknown as ChapaTransport,raw);
  const first=catalog.get(),second=catalog.get();expect(methods).toHaveBeenCalledOnce();raw.CHAPA_PUBLIC_KEY='CHAPA_TEST_PUB_'+'c'.repeat(32);resolve(capabilities());await expect(first).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});await expect(second).rejects.toMatchObject({code:'CONFIGURATION_CHANGED'});
 });
 it('honors explicit method narrowing and enables eBirr only when listed',()=>{
  expect(chapaInlineConfiguredMethods(environment())).toEqual(['telebirr','cbebirr','mpesa']);expect(chapaInlineConfiguredMethods(environment({CHAPA_INLINE_METHODS:'ebirr,telebirr,unknown,telebirr'}))).toEqual(['telebirr','ebirr']);expect(chapaInlineConfiguredMethods(environment({CHAPA_INLINE_METHODS:''}))).toEqual([]);
 });
 it('does not fabricate options when capabilities are malformed or merchant-disabled',async()=>{
  const malformed=createInlineMethodCatalog({methods:async()=>({status:'success',data:[{slug:'telebirr'}]})} as unknown as ChapaTransport,environment());await expect(malformed.get()).rejects.toMatchObject({code:'METHODS_UNAVAILABLE'});
  const result=capabilities();result.data[0].can_process_payments=false;const disabled=createInlineMethodCatalog({methods:async()=>result} as unknown as ChapaTransport,environment());expect(await disabled.get()).toEqual([]);
 });
});
