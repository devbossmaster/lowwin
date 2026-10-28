import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {chapaAvailability,chapaConfigurationFingerprint,createdChapaSession,createChapaTransport,parseChapaEvidence,parseChapaPaymentMethods,parseChapaWebhook,requireChapa,safeChapaCheckoutUrl,verifyChapaWebhook} from '../src/modules/payments/chapa-provider';

const secret='local-only-chapa-webhook-secret-with-thirty-two-bytes';
function environment(patch:Record<string,string|undefined>={}){return {APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@127.0.0.1:5432/chapa_provider_test',MINI_APP_URL:'https://lowwin.test',BETTER_AUTH_URL:'https://lowwin.test',PAYMENT_GATEWAY:'CHAPA',CHAPA_SCHEMA_READY:'true',CHAPA_ENABLED:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(32),CHAPA_WEBHOOK_SECRET:secret,...patch}}
const create={amountCents:'12345',merchantReference:'LW123456789012345678',idempotencyKey:'865ab6e0-c5b9-4716-bded-d213669a5fab',returnUrl:'https://lowwin.test/wallet?chapa=attempt',callbackUrl:'https://lowwin.test/api/payments/chapa/webhook',customer:{first_name:'ሙከራ',phone_number:'251911111111'},meta:{attempt_id:'local-attempt'},description:'Lowwin wallet top up'};
const verified=()=>({status:'success',data:{chapa_reference:'CHLocal123',merchant_reference:create.merchantReference,amount:12345,currency:'ETB',status:'SUCCESS',payment_method:'telebirr',processor_reference:'local-reference',service_fee:370,customer:{phone_number:'251911111111'},meta:{attempt_id:'local-attempt'},mode:'test',created_at:'2026-10-26T10:00:00Z',updated_at:'2026-10-26T10:01:00Z'}});
const initialized=()=>({status:'success',data:{checkout_url:'https://checkout.chapa.global/CHLocal123?intent=opaque',created_at:'2026-10-26T10:00:00Z',expires_at:'2026-10-27T10:00:00Z'}});
const method=(patch:Record<string,unknown>={})=>({name:'Telebirr',slug:'telebirr',is_mobile_money:true,can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:1000000,countries:{ET:{is_enabled:true,min_amount:250,max_amount:500000}}}},...patch});
afterEach(()=>vi.restoreAllMocks());

describe('Chapa v2 configuration boundaries',()=>{
 it('stays disabled with no keys and requires every explicit create gate',()=>{
  expect(chapaAvailability({})).toMatchObject({configured:false,enabled:false,recoveryEnabled:false,mode:'test'});
  expect(chapaAvailability(environment())).toMatchObject({configured:true,enabled:true,recoveryEnabled:true,mode:'test'});
  for(const patch of [{CHAPA_ENABLED:'false'},{CHAPA_SCHEMA_READY:'false'},{PAYMENT_GATEWAY:'ARIFPAY'},{CHAPA_MODE:'invalid'},{CHAPA_PRIVATE_KEY:''},{CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'a'.repeat(32)},{CHAPA_WEBHOOK_SECRET:'short'},{MINI_APP_URL:'http://lowwin.test'},{BETTER_AUTH_URL:'https://other.test'},{CHAPA_BASE_URL:'https://example.test'},{CHAPA_CURRENCY:'USD'}])expect(chapaAvailability(environment(patch)).enabled).toBe(false);
 });
 it('never sends test payments through production or an unreviewed remote database',()=>{
  for(const patch of [{APP_ENV:'production'},{VERCEL_ENV:'production'},{DATABASE_URL:'postgresql://test:test@db.remote.test/postgres'},{APP_ENV:'staging',DATABASE_URL:'postgresql://test:test@db.remote.test/postgres'}])expect(chapaAvailability(environment(patch)).configured).toBe(false);
  expect(chapaAvailability(environment({APP_ENV:'staging',NODE_ENV:'production',DATABASE_URL:'postgresql://test:test@db.remote.test/postgres',CHAPA_TEST_ENVIRONMENT_REVIEWED:'true'})).enabled).toBe(true);
 });
 it('requires separate live approval without turning on legacy funding',()=>{
  const live=environment({APP_ENV:'production',NODE_ENV:'production',CHAPA_MODE:'live',CHAPA_PRIVATE_KEY:'CHAPA_LIVE_'+'b'.repeat(32),CHAPA_MERCHANT_REVIEWED:'true',CHAPA_LIVE_ENABLED:'true',PAYMENTS_LIVE_ENABLED:'false'});
  expect(chapaAvailability(live)).toMatchObject({enabled:true,mode:'live'});
  for(const patch of [{CHAPA_MERCHANT_REVIEWED:'false'},{CHAPA_LIVE_ENABLED:'false'},{NODE_ENV:'development'},{APP_ENV:'staging'},{DEV_POINTS_ENABLED:'true'},{DEV_IDENTITY_ENABLED:'true'},{STAGING_DEMO_ENABLED:'true'},{VERCEL_ENV:'preview'}])expect(chapaAvailability({...live,...patch}).enabled).toBe(false);
 });
 it('keeps reviewed recovery available after creation or gateway selection is paused',()=>{
  const paused=environment({CHAPA_ENABLED:'false',PAYMENT_GATEWAY:'',CHAPA_RECOVERY_ENABLED:'true'});
  expect(chapaAvailability(paused)).toMatchObject({enabled:false,recoveryEnabled:true});expect(()=>requireChapa('create',paused)).toThrow();expect(requireChapa('recover',paused).mode).toBe('test');
  expect(()=>requireChapa('recover',environment({CHAPA_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'false'}))).toThrow();
 });
 it('binds the credential identity to the private key, never the public enable flag',()=>{
  const raw=environment(),fingerprint=chapaConfigurationFingerprint(raw);expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(fingerprint).not.toContain(raw.CHAPA_PRIVATE_KEY);expect(chapaConfigurationFingerprint({...raw,CHAPA_ENABLED:'false'})).toBe(fingerprint);expect(chapaConfigurationFingerprint({...raw,CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'b'.repeat(32)})).not.toBe(fingerprint);expect(chapaConfigurationFingerprint({})).toBeNull();
 });
});

describe('Chapa v2 payment evidence and hosted URL',()=>{
 it('preserves integer cents and keeps operation success separate from paid status',()=>{
  expect(parseChapaEvidence(verified())).toMatchObject({status:'SUCCESS',amountCents:'12345',currency:'ETB',merchantReference:create.merchantReference,chapaReference:'CHLocal123',serviceFeeCents:'370',mode:'test'});
  for(const status of ['PENDING','FAILED','CANCELLED','INCOMPLETE','BLOCKED','AUTH_NEEDED'])expect(parseChapaEvidence({...verified(),data:{...verified().data,status}})?.status).toBe(status);
  expect(parseChapaEvidence({...verified(),status:'error'})).toBeNull();expect(parseChapaEvidence({...verified(),data:{...verified().data,status:'success'}})).toBeNull();
 });
 it('does not reinterpret ETB decimals, unsafe integers, absent identities or misspelled references',()=>{
  for(const amount of ['12345',123.45,-100,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(parseChapaEvidence({...verified(),data:{...verified().data,amount}})).toBeNull();
  const {merchant_reference:_,...data}=verified().data;expect(parseChapaEvidence({status:'success',data:{...data,merchant_referece:create.merchantReference}})).toBeNull();expect(parseChapaEvidence({...verified(),data:{...verified().data,chapa_reference:''}})).toBeNull();
 });
 it('accepts an empty TEST processor field but still requires a final reference for SUCCESS',()=>{
  for(const processor_reference of ['',null,undefined])expect(parseChapaEvidence({...verified(),data:{...verified().data,processor_reference}})).toMatchObject({status:'SUCCESS',processorReference:undefined});
  for(const chapa_reference of [null,undefined]){
   expect(parseChapaEvidence({...verified(),data:{...verified().data,chapa_reference}})).toBeNull();
   expect(parseChapaEvidence({...verified(),data:{...verified().data,chapa_reference,status:'PENDING',processor_reference:null}})).toMatchObject({status:'PENDING',chapaReference:null});
  }
 });
 it('normalizes null optional verification metadata without accepting malformed metadata',()=>{
  for(const meta of [undefined,null])expect(parseChapaEvidence({...verified(),data:{...verified().data,meta}})).toMatchObject({status:'SUCCESS',meta:undefined});
  for(const meta of [{},{provider_note:'optional'},{lowwin_attempt:'an-explicit-attempt'}])expect(parseChapaEvidence({...verified(),data:{...verified().data,meta}})?.meta).toEqual(meta);
  for(const meta of ['',[],123,false])expect(parseChapaEvidence({...verified(),data:{...verified().data,meta}})).toBeNull();
 });
 it('accepts uncollected null payer details in pending and completed hosted responses',()=>{
  const customer={first_name:null,last_name:null,email:null,phone_number:null};
  for(const status of ['PENDING','SUCCESS']){
   const raw={...verified(),data:{...verified().data,status,customer,chapa_reference:status==='SUCCESS'?'CHLocal123':null,processor_reference:null,meta:null}};
   expect(parseChapaEvidence(raw)).toMatchObject({status,merchantReference:create.merchantReference,amountCents:'12345',currency:'ETB',customer:{first_name:undefined,last_name:undefined,email:undefined,phone_number:undefined}});
   expect(raw.data.customer).toEqual(customer);
  }
  expect(parseChapaEvidence({...verified(),data:{...verified().data,customer,chapa_reference:null}})).toBeNull();
  for(const change of [{amount:123.45},{merchant_reference:''},{currency:'etb'},{status:'success'},{mode:'unknown'}])expect(parseChapaEvidence({...verified(),data:{...verified().data,customer,...change}})).toBeNull();
  for(const invalid of [123,false,[],{},'x'.repeat(255)])expect(parseChapaEvidence({...verified(),data:{...verified().data,customer:{...customer,email:invalid}}})).toBeNull();
 });
 it('keeps the TEST checkout session token separate from the final payment reference',()=>{
  const checkout_url='https://checkout.chapa.global/test/payment/hosted/TEST123456';
  expect(createdChapaSession({status:'success',data:{checkout_url}})).toMatchObject({checkoutUrl:checkout_url,checkoutReference:'TEST123456',chapaReference:null});
  expect(safeChapaCheckoutUrl('https://checkout.chapa.global/TEST123456')).toMatchObject({chapaReference:'TEST123456'});
 });
 it('returns exact provider URL and dates but rejects open-redirect and reference confusion',()=>{
  expect(createdChapaSession(initialized())).toMatchObject({checkoutUrl:initialized().data.checkout_url,chapaReference:'CHLocal123',createdAt:new Date('2026-10-26T10:00:00Z'),expiresAt:new Date('2026-10-27T10:00:00Z')});
  for(const url of ['http://checkout.chapa.global/CHLocal123','https://checkout.chapa.global.evil.test/CHLocal123','https://user:secret@checkout.chapa.global/CHLocal123','https://checkout.chapa.global:8443/CHLocal123','https://checkout.chapa.global/','https://checkout.chapa.global/CH%2F123','https://checkout.chapa.global/CHLocal123#redirect','https://evil.test/CHLocal123','javascript:alert(1)',' https://checkout.chapa.global/CHLocal123','https://checkout.chapa.global\\@evil.test/CHLocal123'])expect(safeChapaCheckoutUrl(url)).toBeNull();
  expect(createdChapaSession({...initialized(),data:{...initialized().data,expires_at:'2026-10-25T10:00:00Z'}})).toBeNull();expect(createdChapaSession({status:'success',data:{checkout_url:initialized().data.checkout_url}})).toMatchObject({checkoutUrl:initialized().data.checkout_url,chapaReference:'CHLocal123',createdAt:undefined,expiresAt:undefined});expect(createdChapaSession({...initialized(),data:{...initialized().data,created_at:'not-a-date'}})).toBeNull();expect(createdChapaSession({...initialized(),data:{...initialized().data,expires_at:'2026-13-01T10:00:00Z'}})).toBeNull();
 });
 it('uses only actual enabled ETB/ET methods and their country limits',()=>{
  expect(parseChapaPaymentMethods({status:'success',data:[method()]})).toEqual([{name:'Telebirr',slug:'telebirr',minimumCents:'250',maximumCents:'500000',isMobileMoney:true}]);
  const disabled=method({can_process_payments:false}),wrongCountry=method({slug:'mpesa',supported_currencies:{ETB:{default_min:100,default_max:1000,countries:{ET:{is_enabled:false}}}}}),noEtb=method({slug:'other',supported_currencies:{USD:{default_min:100,default_max:1000,countries:{US:{is_enabled:true}}}}});
  expect(parseChapaPaymentMethods({status:'success',data:[method(),disabled,wrongCountry,noEtb,method()]})).toHaveLength(1);expect(parseChapaPaymentMethods({status:'error',data:[method()]})).toBeNull();
 });
});

describe('Chapa v2 authenticated webhook hints',()=>{
 it('authenticates exact UTF-8 bytes with the configured webhook secret and constant-length hex',()=>{
  const raw=Buffer.from('{ "webhook_type": "payment", "meta": {"label":"ሙከራ"} }'),signature=createHmac('sha256',secret).update(raw).digest('hex');
  expect(verifyChapaWebhook(raw,signature,secret)).toBe(true);expect(verifyChapaWebhook(raw,signature.toUpperCase(),secret)).toBe(true);expect(verifyChapaWebhook(JSON.stringify(JSON.parse(raw.toString('utf8'))),signature,secret)).toBe(false);
  for(const header of [null,undefined,'',signature.slice(1),signature+'0','x'.repeat(64),'sha256='+signature,signature+', '+signature])expect(verifyChapaWebhook(raw,header,secret)).toBe(false);expect(verifyChapaWebhook(raw,signature,'different-webhook-secret-thirty-two-bytes')).toBe(false);expect(verifyChapaWebhook(raw,signature,'short')).toBe(false);
 });
 it('rejects a constant secret proof that does not authenticate the event body',()=>{
  const signature=createHmac('sha256',secret).update(secret).digest('hex');
  for(const amount of [1000,1029])expect(verifyChapaWebhook(JSON.stringify({webhook_type:'payment',event:'payment.success',status:'success',amount}),signature,secret)).toBe(false);
 });
 it('does not confuse lowercase webhook success with uppercase verification completion',()=>{
  const event={webhook_type:'payment',event:'payment.success',status:'success',mode:'test',amount:'12345',currency:'ETB',merchant_reference:create.merchantReference,chapa_reference:'CHLocal123',updated_at:'2026-10-26T10:01:00Z'};
  expect(parseChapaWebhook(event)).toMatchObject({type:'payment',event:'payment.success',status:'success',mode:'test',amountCents:'12345'});expect(parseChapaWebhook({...event,status:'SUCCESS'})).toBeNull();expect(parseChapaEvidence(event)).toBeNull();expect(parseChapaWebhook({...event,amount:'123.45'})).toBeNull();
 });
 it('normalizes null webhook metadata while rejecting nonobject values',()=>{
  const event={webhook_type:'payment',event:'payment.success',status:'success'};
  for(const meta of [undefined,null])expect(parseChapaWebhook({...event,meta})).toMatchObject({type:'payment',meta:undefined});
  expect(parseChapaWebhook({...event,meta:{note:'optional'}})?.meta).toEqual({note:'optional'});
  for(const meta of ['',[],123,false])expect(parseChapaWebhook({...event,meta})).toBeNull();
 });
 it('retains a provider payment hint with null merchant reference without changing its reported amount',()=>{
  const event={webhook_type:'payment',event:'payment.success',status:'success',mode:'test',merchant_reference:null,chapa_reference:'CHLocal123',amount:1029,currency:'ETB'};
  expect(parseChapaWebhook(event)).toMatchObject({merchantReference:undefined,chapaReference:'CHLocal123',amountCents:'1029',mode:'test'});
  for(const merchant_reference of ['',[],{},123,false])expect(parseChapaWebhook({...event,merchant_reference})).toBeNull();
 });
});

describe('Chapa v2 bounded merchant transport',()=>{
 it('sends cents, a stable idempotency key and no card data to the fixed hosted endpoint',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(initialized())),transport=createChapaTransport({env:environment(),fetcher});await transport.create(create);await transport.create(create);
  expect(fetcher).toHaveBeenCalledTimes(2);const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://api.chapa.global/v2/payments/hosted');expect(options).toMatchObject({method:'POST',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+environment().CHAPA_PRIVATE_KEY,'Idempotency-Key':create.idempotencyKey,'Content-Type':'application/json'}});expect(options?.signal).toBeInstanceOf(AbortSignal);
  const body=JSON.parse(String(options?.body));expect(body).toEqual({amount:12345,currency:'ETB',merchant_reference:create.merchantReference});expect(fetcher.mock.calls[1][1]?.body).toBe(options?.body);expect(fetcher.mock.calls[1][1]?.headers).toEqual(options?.headers);
 });
 it('leaves payer contact and payment method selection to hosted checkout when omitted',async()=>{
  const {customer:_,...hosted}=create,fetcher=vi.fn<typeof fetch>(async()=>Response.json(initialized()));
  await createChapaTransport({env:environment(),fetcher}).create(hosted);
  const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body).not.toHaveProperty('customer');expect(body).not.toHaveProperty('phone_number');expect(body).not.toHaveProperty('preferred_payment_methods');
  expect(body).toEqual({amount:12345,currency:'ETB',merchant_reference:hosted.merchantReference});
 });
 it('rejects invalid amounts, keys, identity or external return URLs before contacting Chapa',async()=>{
  const fetcher=vi.fn<typeof fetch>(),transport=createChapaTransport({env:environment(),fetcher});
  for(const patch of [{amountCents:'99'},{amountCents:'100.00'},{amountCents:'9007199254740992'},{merchantReference:'A'.repeat(21)},{idempotencyKey:'bad\r\nheader'},{returnUrl:'https://evil.test/return'},{callbackUrl:'http://lowwin.test/webhook'},{customer:{card_number:'do-not-collect'}},{customer:{phone_number:null}}])await expect(transport.create({...create,...patch} as unknown as Parameters<typeof transport.create>[0])).rejects.toMatchObject({status:422});
  expect(fetcher).not.toHaveBeenCalled();await expect(createChapaTransport({env:environment({CHAPA_ENABLED:'false'}),fetcher}).create(create)).rejects.toMatchObject({status:503,code:'PAYMENT_UNAVAILABLE'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses the merchant-authenticated verify/method paths and rejects caller-controlled paths',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(verified())),transport=createChapaTransport({env:environment(),fetcher});await transport.lookup('CHLocal123');await transport.methods();expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['https://api.chapa.global/v2/payments/CHLocal123/verify','https://api.chapa.global/v2/payments/methods']);for(const reference of ['../balance','a/b','x?key=value',''])await expect(transport.lookup(reference)).rejects.toMatchObject({status:422});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('sanitizes HTTP/network/body errors without provider details or private key leakage',async()=>{
  for(const response of [new Response('secret-provider-body',{status:401}),new Response('not json'),new Response('x'.repeat(65537))]){
   const transport=createChapaTransport({env:environment(),fetcher:vi.fn(async()=>response)});await expect(transport.lookup('CHLocal123')).rejects.toMatchObject({status:502,code:'PROVIDER_UNAVAILABLE',message:'Payment confirmation is pending. Check this same payment again.'});
  }
  const transport=createChapaTransport({env:environment(),fetcher:vi.fn(async()=>{throw Error('private-key-and-customer-details')})});await expect(transport.lookup('CHLocal123')).rejects.not.toThrow('private-key-and-customer-details');
 });
});
