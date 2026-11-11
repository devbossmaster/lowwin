import {describe, expect, it, vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {ChapaProviderError} from '../src/modules/payments/chapa-provider';
import {authenticateChapaV1Webhook, chapaV1Availability, chapaV1ConfigurationFingerprint, createdChapaV1Session, createChapaV1Transport, parseChapaV1Evidence, parseChapaV1Webhook} from '../src/modules/payments/chapa-v1-provider';

const secret = 'isolated-v1-signing-secret-with-thirty-two-bytes';
function env(patch: Record<string,string|undefined> = {}) {
  return {APP_ENV:'local', NODE_ENV:'test', DATABASE_URL:'postgresql://local:local@127.0.0.1:55451/v1_test', MINI_APP_URL:'https://lowwin.test/telegram', BETTER_AUTH_URL:'https://lowwin.test', PAYMENT_GATEWAY:'CHAPA',
    CHAPA_V1_MODE:'test', CHAPA_V1_ENABLED:'true', CHAPA_V1_RECOVERY_ENABLED:'true', CHAPA_V1_SCHEMA_READY:'true', CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40), CHAPA_V1_WEBHOOK_SECRET:secret, ...patch};
}
const intent = {amountCents:'10001', merchantReference:'LWoriginal', idempotencyKey:'original-local-request-123', customer:{phone_number:'0712345678'},
  returnUrl:'https://lowwin.test/payments/chapa/return?checkout=opaque', callbackUrl:'https://lowwin.test/api/payments/chapa/v1/callback?checkout=opaque'};
const verification = (patch: Record<string,unknown> = {}) => ({status:'success', data:{tx_ref:'LWoriginal', reference:'APoriginal', amount:'100.01', currency:'ETB', status:'success', mode:'test', charge:'3.00', meta:null, ...patch}});
const event = {event:'charge.success', status:'success', tx_ref:'LWoriginal', reference:'APoriginal', amount:'100.01', currency:'ETB', charge:'3.00', mode:'test', meta:null};

describe('v1 environment isolation', () => {
  it('never enables v1 from v2 credentials or switches', () => {
    expect(chapaV1Availability({CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40), CHAPA_ENABLED:'true'})).toMatchObject({enabled:false, recoveryEnabled:false});
    expect(chapaV1Availability(env())).toMatchObject({apiVersion:1, enabled:true, mode:'test'});
    for (const patch of [{CHAPA_V1_SECRET_KEY:'CHAPA_TEST_'+'a'.repeat(40)}, {CHAPA_V1_MODE:'live'}, {CHAPA_V1_SCHEMA_READY:'false'}, {MINI_APP_URL:'http://lowwin.test'}, {BETTER_AUTH_URL:'https://other.test'}, {CHAPA_V1_BASE_URL:'https://attacker.test'}, {APP_ENV:'production'}, {VERCEL_ENV:'production'}, {DATABASE_URL:'postgresql://local:local@unreviewed.test/db'}]) expect(chapaV1Availability(env(patch)).configured).toBe(false);
  });
  it('requires separate live approval and keeps recovery when creation pauses', () => {
    const live = env({APP_ENV:'production', NODE_ENV:'production', CHAPA_V1_MODE:'live', CHAPA_V1_SECRET_KEY:'CHASECK-'+'b'.repeat(40), CHAPA_V1_MERCHANT_REVIEWED:'true', CHAPA_V1_LIVE_ENABLED:'true'});
    expect(chapaV1Availability(live).enabled).toBe(true);
    for (const patch of [{CHAPA_V1_MERCHANT_REVIEWED:'false'}, {CHAPA_V1_LIVE_ENABLED:'false'}, {DEV_POINTS_ENABLED:'true'}, {STAGING_DEMO_ENABLED:'true'}]) expect(chapaV1Availability({...live,...patch}).enabled).toBe(false);
    expect(chapaV1Availability(env({CHAPA_V1_ENABLED:'false'}))).toMatchObject({enabled:false,recoveryEnabled:true});
    expect(chapaV1ConfigurationFingerprint(env())).not.toBe(chapaV1ConfigurationFingerprint(env({CHAPA_V1_BASE_URL:'https://api.chapa.global'})));
  });
});

describe('v1 amount and evidence contract', () => {
  it('converts ETB to exact internal cents and requires lowercase completed evidence', () => {
    expect(parseChapaV1Evidence(verification())).toMatchObject({merchantReference:'LWoriginal', chapaReference:'APoriginal', amountCents:'10001', serviceFeeCents:'300', status:'SUCCESS', mode:'test'});
    expect(parseChapaV1Evidence(verification({amount:100.01}))?.amountCents).toBe('10001');
    expect(parseChapaV1Evidence(verification({amount:'10000'}))?.amountCents).toBe('1000000');
    for (const amount of ['1.001', '-1', 1.001, '1e2', NaN, Infinity]) expect(parseChapaV1Evidence(verification({amount}))).toBeNull();
    for (const patch of [{status:'SUCCESS'}, {currency:'USD'}, {reference:null}, {mode:'unknown'}, {tx_ref:''}]) expect(parseChapaV1Evidence(verification(patch))).toBeNull();
    expect(parseChapaV1Evidence({...verification(),status:'failed'})).toBeNull();
  });
  it('normalizes unpaid outcomes without granting funds or interpreting metadata as identity', () => {
    for (const status of ['pending','failed','cancelled','failed/cancelled','refunded','reversed']) expect(parseChapaV1Evidence(verification({status}))?.status).not.toBe('SUCCESS');
    for (const meta of [undefined,null,{}, {provider:'optional'}]) expect(parseChapaV1Evidence(verification({meta}))?.status).toBe('SUCCESS');
    for (const meta of [123, false, [], 'invalid']) expect(parseChapaV1Evidence(verification({meta}))).toBeNull();
    expect(parseChapaV1Webhook(event)).toMatchObject({type:'payment', amountCents:'10001', merchantReference:'LWoriginal'});
    expect(parseChapaV1Webhook({...event,event:'charge.refunded',status:'refunded'})?.type).toBe('refund');
    expect(parseChapaV1Webhook({...event,status:'pending'})).toBeNull();
  });
  it('does not confuse an initialization URL with a final payment reference', () => {
    expect(createdChapaV1Session({status:'success',data:{checkout_url:'https://checkout.chapa.co/checkout/payment/opaque'}})).toMatchObject({checkoutUrl:'https://checkout.chapa.co/checkout/payment/opaque',chapaReference:null});
    for (const checkout_url of ['https://checkout.chapa.co.evil.test/payment','http://checkout.chapa.co/payment','https://user@checkout.chapa.co/payment','https://checkout.chapa.co:444/payment','https://checkout.chapa.co/payment#spoof','https://checkout.chapa.global/payment','https://checkout.chapa.co\\@evil.test/payment']) expect(createdChapaV1Session({status:'success',data:{checkout_url}})).toBeNull();
    expect(createdChapaV1Session({status:'success',data:{checkout_url:'https://checkout.chapa.global/payment/opaque'}},env({CHAPA_V1_BASE_URL:'https://api.chapa.global'}))).not.toBeNull();
  });
});

describe('v1 signed notification profiles', () => {
  it.each(['json_body','raw_body','custom_json_body','legacy_secret'])('accepts only the selected %s calculation/header', profile => {
    const raw = env({CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE:profile}), bytes = Buffer.from(JSON.stringify(event,null,2));
    const message = profile === 'legacy_secret' ? secret : profile === 'raw_body' ? bytes : JSON.stringify(event);
    const header = profile === 'legacy_secret' || profile === 'custom_json_body' ? 'chapa-signature' : 'x-chapa-signature';
    const headers = new Headers({[header]:createHmac('sha256',secret).update(message).digest('hex')});
    expect(authenticateChapaV1Webhook(bytes,headers,raw)).toBe(profile);
    expect(authenticateChapaV1Webhook(bytes,new Headers(),raw)).toBeNull();
    expect(authenticateChapaV1Webhook(bytes,new Headers({[header]:'g'.repeat(64)}),raw)).toBeNull();
    if(profile !== 'legacy_secret') expect(authenticateChapaV1Webhook(Buffer.from(JSON.stringify({...event,amount:'1000'})),headers,raw)).toBeNull();
    else expect(authenticateChapaV1Webhook(bytes,headers,env())).toBeNull();
  });
});

describe('v1 hosted server transport', () => {
  it('sends decimal ETB, tx_ref, local phone, callbacks, and a server-only bearer key', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => Response.json({status:'success',data:{checkout_url:'https://checkout.chapa.co/payment/opaque'}}));
    const transport = createChapaV1Transport({env:env(),fetcher});
    await transport.create(intent);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.chapa.co/v1/transaction/initialize');
    expect(JSON.parse(String(options.body))).toEqual({amount:'100.01', currency:'ETB', tx_ref:'LWoriginal', phone_number:'0712345678', return_url:intent.returnUrl, callback_url:intent.callbackUrl});
    expect(options.headers).toEqual({Authorization:'Bearer '+env().CHAPA_V1_SECRET_KEY, 'Content-Type':'application/json'});
    expect(options).toMatchObject({cache:'no-store',redirect:'error'});
    await transport.lookup('LWoriginal');
    expect(fetcher.mock.calls[1][0]).toBe('https://api.chapa.co/v1/transaction/verify/LWoriginal');
    await expect(transport.methods()).rejects.toMatchObject({status:410});
  });
  it('rejects foreign return URLs, invalid phone and amount before HTTP', async () => {
    const fetcher = vi.fn(), transport = createChapaV1Transport({env:env(),fetcher});
    for (const patch of [{returnUrl:'https://attacker.test/return'}, {callbackUrl:'http://lowwin.test/callback'}, {amountCents:'0'}, {customer:{phone_number:'251712345678'}}]) await expect(transport.create({...intent,...patch})).rejects.toMatchObject({status:422});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps unpaid 404 and duplicate-reference initialization as nonterminal recovery signals', async () => {
    const transport = createChapaV1Transport({env:env(),fetcher:vi.fn(async () => Response.json({status:'failed',message:'Payment not paid yet'},{status:404}))});
    await expect(transport.lookup('LWoriginal')).rejects.toBeInstanceOf(ChapaProviderError);
    await expect(transport.lookup('LWoriginal')).rejects.toMatchObject({httpStatus:404,providerCode:'NOT_FOUND'});
    const duplicate = createChapaV1Transport({env:env(),fetcher:vi.fn(async () => Response.json({message:'Transaction reference has been used before'},{status:400}))});
    await expect(duplicate.create(intent)).rejects.toMatchObject({httpStatus:409,providerCode:'INVALID_STATE',definiteRejection:false});
  });
});
