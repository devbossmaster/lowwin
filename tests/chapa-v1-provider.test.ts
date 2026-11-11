import {describe,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {authenticateChapaV1Webhook,chapaV1Availability,chapaV1Methods,createChapaV1Transport,isV1Checkout,parseChapaV1Evidence,parseChapaV1Webhook,safeV1CheckoutUrl} from '../src/modules/payments/chapa-v1-provider';
const secret='local-v1-webhook-secret-with-at-least-thirty-two-bytes';
const env=(patch:Record<string,string|undefined>={})=>({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local@127.0.0.1:55608/chapa_v1_test',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_V1_ENABLED:'true',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(32),CHAPA_V1_PUBLIC_KEY:'CHAPUBK_TEST-'+'b'.repeat(32),CHAPA_V1_WEBHOOK_SECRET:secret,...patch});
const evidence=(patch:Record<string,unknown>={})=>({status:'success',data:{tx_ref:'LW123456789012345678',reference:'AP-final-reference',amount:'50.25',charge:'1.25',currency:'ETB',mode:'test',status:'success',payment_method:'telebirr',...patch}});
describe('v1 versioned payment boundary',()=>{
 it('requires separately configured keys, webhook secret and explicit merchant methods',()=>{
  expect(chapaV1Availability(env())).toMatchObject({enabled:true,recoveryEnabled:true,mode:'test'});expect(chapaV1Methods(env())).toEqual([]);
  expect(chapaV1Methods(env({CHAPA_V1_METHODS:'telebirr,unknown,cbebirr,telebirr,mpesa,ebirr'})).map(v=>v.slug)).toEqual(['telebirr','cbebirr','mpesa','ebirr']);
  for(const patch of [{CHAPA_V1_SECRET_KEY:'CHAPA_TEST_'+'a'.repeat(32)},{CHAPA_V1_PUBLIC_KEY:'CHAPUBK-'+'b'.repeat(32)},{CHAPA_V1_WEBHOOK_SECRET:'short'},{CHAPA_V1_ENABLED:'false'}])expect(chapaV1Availability(env(patch)).enabled).toBe(false);
 });
 it('does not accept test credentials in live or live credentials in test',()=>{
  const live={APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true'};
  expect(chapaV1Availability(env(live)).configured).toBe(false);
  expect(chapaV1Availability(env({...live,CHAPA_V1_SECRET_KEY:'CHASECK-'+'a'.repeat(32),CHAPA_V1_PUBLIC_KEY:'CHAPUBK-'+'b'.repeat(32)})).enabled).toBe(true);
 });
 it('recognizes only the server-owned v1 initialization marker',()=>{expect(isV1Checkout({initialization:{apiVersion:'v1'}})).toBe(true);for(const initialization of [{flowVersion:3},{apiVersion:'v2'},null,[]])expect(isV1Checkout({initialization})).toBe(false)});
 it('converts major ETB units exactly and separates tx_ref from the final provider reference',()=>{
  expect(parseChapaV1Evidence(evidence())).toMatchObject({merchantReference:'LW123456789012345678',chapaReference:'AP-final-reference',amountCents:'5025',serviceFeeCents:'125',status:'SUCCESS',mode:'test'});
  expect(parseChapaV1Evidence(evidence({amount:50.25}))).toMatchObject({amountCents:'5025'});
  expect(parseChapaV1Evidence(evidence({amount:'50.250000',charge:'1.250000'}))).toMatchObject({amountCents:'5025',serviceFeeCents:'125'});
  expect(parseChapaV1Evidence(evidence({amount:'5025'}))).toMatchObject({amountCents:'502500'});
 });
 it('rejects ambiguous decimals, missing environment, final success without reference, and v2-shaped data',()=>{
  for(const patch of [{amount:'50.251'},{amount:50.251},{mode:undefined},{reference:null},{tx_ref:undefined},{status:'maybe'}])expect(parseChapaV1Evidence(evidence(patch))).toBeNull();
  expect(parseChapaV1Evidence({status:'success',data:{merchant_reference:'LWref',chapa_reference:'CHref',amount:5025,status:'SUCCESS',currency:'ETB'}})).toBeNull();
 });
 it('preserves confirmed nonpaid outcomes without requiring a final reference',()=>{for(const [status,expected] of [['pending','PENDING'],['cancelled','CANCELLED'],['failed','FAILED'],['incomplete','INCOMPLETE']])expect(parseChapaV1Evidence(evidence({status,reference:null}))).toMatchObject({status:expected})});
 it('accepts either documented signature proof and verifies raw bytes without reserialization',()=>{
  const body=new TextEncoder().encode('{ "tx_ref": "LWref" }'),headers=new Headers({'x-chapa-signature':createHmac('sha256',secret).update(body).digest('hex')});expect(authenticateChapaV1Webhook(body,headers,secret)).toBe(true);
  const changed=new TextEncoder().encode('{"tx_ref":"LWref"}');expect(authenticateChapaV1Webhook(changed,headers,secret)).toBe(false);
  headers.set('chapa-signature',createHmac('sha256',secret).update(secret).digest('hex'));expect(authenticateChapaV1Webhook(changed,headers,secret)).toBe(true);
  expect(authenticateChapaV1Webhook(body,new Headers(),secret)).toBe(false);expect(authenticateChapaV1Webhook(body,new Headers({'chapa-signature':'x'}),secret)).toBe(false);
 });
 it('routes only v1 charge events by merchant tx_ref',()=>{expect(parseChapaV1Webhook({event:'charge.success',tx_ref:'LWref',mode:'test',currency:'ETB',status:'success'})).toMatchObject({merchantReference:'LWref'});expect(parseChapaV1Webhook({event:'payment.success',merchant_reference:'LWref',mode:'test',currency:'ETB',status:'success'})).toBeNull()});
 it('returns only trusted secure hosted URLs without constructing them',()=>{expect(safeV1CheckoutUrl('https://checkout.chapa.co/checkout/payment/opaque?keep=1')).toBe('https://checkout.chapa.co/checkout/payment/opaque?keep=1');for(const value of ['http://checkout.chapa.co/a','https://evil.test/a','https://checkout.chapa.co@evil.test/a','https://checkout.chapa.co/a#hash'])expect(safeV1CheckoutUrl(value)).toBeNull()});
 it('uses v1 endpoints, major-unit payload and local phone while keeping secret server-side',async()=>{
  const fetcher=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>Response.json({status:'success',data:{}})),transport=createChapaV1Transport({env:env(),fetcher:fetcher as typeof fetch});await transport.initialize({txRef:'LWref',amountCents:'5025',phone:'0911652904',returnUrl:'https://lowwin.test/return',callbackUrl:'https://lowwin.test/callback'});expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.chapa.co/v1/transaction/initialize');const options=fetcher.mock.calls[0]?.[1] as RequestInit;expect(JSON.parse(options.body as string)).toMatchObject({amount:'50.25',tx_ref:'LWref',phone_number:'0911652904'});expect(options.headers).not.toHaveProperty('Idempotency-Key');await transport.lookup('LWref');expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.chapa.co/v1/transaction/verify/LWref');
 });
});
