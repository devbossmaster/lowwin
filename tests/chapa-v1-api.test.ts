import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHmac,randomUUID} from 'node:crypto';

type Event={id:string;apiVersion:number;checkoutId:string|null;merchantReference:string|null;mode:string;configurationFingerprint:string;bodyHash:string;status:string;attempts:number;nextAttemptAt:Date;leaseUntil:Date|null;completedAt:Date|null;receivedAt:Date};
const f=vi.hoisted(()=>({after:vi.fn(),process:vi.fn(),transaction:vi.fn(),find:vi.fn(),create:vi.fn(),recent:vi.fn(),lock:vi.fn(),updateEvent:vi.fn(),updateOrder:vi.fn(),rows:new Map<string,Event>()}));
vi.mock('next/server',()=>({after:f.after}));
vi.mock('../src/lib/db',()=>({db:{$transaction:f.transaction}}));
vi.mock('../src/modules/payments/chapa-events',()=>({processChapaEvent:f.process}));
import {POST as webhook} from '../src/app/api/payments/chapa/v1/webhook/route';
import {POST as legacyWebhook} from '../src/app/api/payments/chapa/webhook/route';
import {GET as callback,POST as callbackPost} from '../src/app/api/payments/chapa/v1/callback/route';
import {chapaV1WebhookConfigurationFingerprint} from '../src/modules/payments/chapa-v1-provider';

const origin='https://lowwin.test',id=randomUUID(),merchant='LW123456789012345678',secret='independent-v1-webhook-secret-thirty-two-characters';
const hint={event:'charge.success',status:'success',mode:'test',tx_ref:merchant,reference:'APgeneratedPaymentRef',amount:'10.00',currency:'ETB'};
function signed(value:unknown,profile='json_body',bytes?:Uint8Array){
 const raw=bytes??Buffer.from(JSON.stringify(value)),message=profile==='legacy_secret'?secret:profile==='raw_body'?raw:JSON.stringify(JSON.parse(new TextDecoder().decode(raw)));
 return new Request(origin+'/api/payments/chapa/v1/webhook',{method:'POST',headers:{'content-type':'application/json',[profile==='legacy_secret'||profile==='custom_json_body'?'chapa-signature':'x-chapa-signature']:createHmac('sha256',secret).update(message).digest('hex')},body:raw as BodyInit});
}
const order=()=>({id,apiVersion:1,merchantReference:merchant,mode:'test',chapaReference:null,amountCents:1000n,currency:'ETB',creditJournalId:null,status:'PENDING',providerStatus:null,verificationState:'UNVERIFIED'});
beforeEach(()=>{
 vi.clearAllMocks();f.rows.clear();f.after.mockImplementation(()=>undefined);f.process.mockResolvedValue(true);
 for(const [name,value] of Object.entries({APP_ENV:'local',NODE_ENV:'test',DATABASE_URL:'postgresql://local:local@127.0.0.1:5432/chapa_test',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,PAYMENT_GATEWAY:'CHAPA',CHAPA_V1_ENABLED:'true',CHAPA_V1_RECOVERY_ENABLED:'true',CHAPA_V1_SCHEMA_READY:'true',CHAPA_V1_MODE:'test',CHAPA_V1_SECRET_KEY:'CHASECK_TEST-'+'a'.repeat(40),CHAPA_V1_WEBHOOK_SECRET:secret,CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE:'json_body',CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',CHAPA_SCHEMA_READY:'true',CHAPA_MODE:'test',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'b'.repeat(40),CHAPA_WEBHOOK_SECRET:secret,CHAPA_WEBHOOK_SIGNATURE_PROFILE:'raw_body'}))vi.stubEnv(name,value);
 f.find.mockResolvedValue(order());f.updateOrder.mockResolvedValue({count:1});
 f.create.mockImplementation(async({data}:any)=>{const item=data[0];if([...f.rows.values()].some(row=>row.apiVersion===item.apiVersion&&row.mode===item.mode&&row.configurationFingerprint===item.configurationFingerprint&&row.bodyHash===item.bodyHash))return {count:0};f.rows.set(item.id,{...item,attempts:0,nextAttemptAt:new Date(),leaseUntil:null,completedAt:null,receivedAt:new Date()});return {count:1}});
 f.recent.mockImplementation(async({where}:any)=>{const row=[...f.rows.values()].find(row=>row.apiVersion===where.apiVersion&&row.checkoutId===where.checkoutId&&row.configurationFingerprint===where.configurationFingerprint);return row?{id:row.id}:null});
 f.lock.mockImplementation(async(query:TemplateStringsArray,...values:unknown[])=>query.join('').includes('"ChapaWebhookEvent"')?[f.rows.get(String(values[0]))]:[{creditJournalId:null}]);
 f.updateEvent.mockImplementation(async({where,data}:any)=>{Object.assign(f.rows.get(where.id)!,data);return {count:1}});
 f.transaction.mockImplementation(async(run:any)=>run({$queryRaw:f.lock,chapaCheckout:{findUnique:f.find,updateMany:f.updateOrder},chapaWebhookEvent:{createMany:f.create,findFirst:f.recent,updateMany:f.updateEvent}}));
 vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No provider calls belong to webhook acknowledgement'));
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

describe('v1 durable hosted payment delivery',()=>{
 it('commits an authenticated hint before scheduling authoritative verification and deduplicates delivery',async()=>{
  const tasks:(()=>Promise<void>)[]=[];f.after.mockImplementation(task=>tasks.push(task));
  for(let i=0;i<2;i++){const response=await webhook(signed(hint));expect(response.status).toBe(200);expect(await response.json()).toEqual({accepted:true});expect(response.headers.get('cache-control')).toContain('no-store')}
  expect(f.rows.size).toBe(1);expect([...f.rows.values()][0]).toMatchObject({apiVersion:1,checkoutId:id,status:'QUEUED',event:'charge.success'});
  expect(tasks).toHaveLength(1);expect(f.process).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  await tasks[0]();expect(f.process).toHaveBeenCalledExactlyOnceWith(expect.anything(),expect.any(String));
 });
 it.each(['json_body','raw_body','custom_json_body'])('uses only the selected %s signature profile',async profile=>{
  vi.stubEnv('CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE',profile);
  expect((await webhook(signed(hint,profile))).status).toBe(200);
  const other=profile==='raw_body'?'custom_json_body':'raw_body';
  const bytes=Buffer.from('  '+JSON.stringify(hint));
  expect((await webhook(signed(hint,other,bytes))).status).toBe(401);
  expect(f.rows.size).toBe(1);
 });
 it('rejects a tampered body, unrecognized profile, missing secret, and a disabled recovery version before database access',async()=>{
  const original=signed(hint),headers=original.headers;
  expect((await webhook(new Request(original.url,{method:'POST',headers,body:JSON.stringify({...hint,amount:'20.00'})}))).status).toBe(401);
  vi.stubEnv('CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE','unknown');expect((await webhook(signed(hint))).status).toBe(503);
  vi.stubEnv('CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE','json_body');vi.stubEnv('CHAPA_V1_WEBHOOK_SECRET','');expect((await webhook(signed(hint))).status).toBe(503);
  vi.stubEnv('CHAPA_V1_WEBHOOK_SECRET',secret);vi.stubEnv('CHAPA_V1_ENABLED','false');vi.stubEnv('CHAPA_V1_RECOVERY_ENABLED','false');expect((await webhook(signed(hint))).status).toBe(503);
  expect(f.transaction).not.toHaveBeenCalled();
 });
 it('rejects contradictory event/status and mode before any checkout access',async()=>{
  for(const change of [{status:'failed'},{event:'charge.failed'},{mode:'live'},{amount:'10.001'},{currency:'USD'},{tx_ref:''}])expect((await webhook(signed({...hint,...change}))).status).toBe(400);
  expect(f.transaction).not.toHaveBeenCalled();
 });
 it('keeps unmatched amount, reference, currency and historical v2 rows out of the verification queue',async()=>{
  for(const change of [{amountCents:1100n},{chapaReference:'OTHERpayment'},{currency:'USD'},{apiVersion:2}]){
   f.find.mockResolvedValue({...order(),...change});expect((await webhook(signed({...hint,meta:{sequence:JSON.stringify(change,(_key,value)=>typeof value==='bigint'?String(value):value)}}))).status).toBe(200);
  }
  expect([...f.rows.values()].every(row=>row.checkoutId===null&&row.status==='IGNORED')).toBe(true);expect(f.updateOrder).not.toHaveBeenCalled();expect(f.after).not.toHaveBeenCalled();
 });
 it('never binds a historical v2 route delivery to a v1 checkout',async()=>{
  const value={webhook_type:'payment',event:'payment.success',status:'success',mode:'test',merchant_reference:merchant,chapa_reference:hint.reference,amount:'1000',currency:'ETB'};
  expect((await legacyWebhook(signed(value,'raw_body'))).status).toBe(200);
  expect([...f.rows.values()][0]).toMatchObject({apiVersion:2,checkoutId:null,status:'IGNORED'});expect(f.after).not.toHaveBeenCalled();
 });
 it('keeps legacy secret authentication bounded to one canonical job without trusting body integrity',async()=>{
  vi.stubEnv('CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE','legacy_secret');
  const prior:Event={id:'canonical-v1-event',apiVersion:1,checkoutId:id,merchantReference:merchant,mode:'test',configurationFingerprint:chapaV1WebhookConfigurationFingerprint(),bodyHash:'a'.repeat(64),status:'QUEUED',attempts:2,nextAttemptAt:new Date(Date.now()+60000),leaseUntil:null,completedAt:null,receivedAt:new Date(Date.now()-120000)};
  f.rows.set(prior.id,prior);
  for(let sequence=0;sequence<4;sequence++)expect((await webhook(signed({...hint,meta:{sequence}},'legacy_secret'))).status).toBe(200);
  expect(f.rows.size).toBe(1);expect(f.create).not.toHaveBeenCalled();expect(f.updateEvent).not.toHaveBeenCalled();expect(f.after).not.toHaveBeenCalled();
  f.find.mockResolvedValue(null);expect((await webhook(signed(hint,'legacy_secret'))).status).toBe(200);expect(f.rows.size).toBe(1);
 });
 it('never retains a raw body, customer details, or secret in the durable delivery record',async()=>{
  expect((await webhook(signed({...hint,customer:{phone_number:'0911111111'},meta:{email:'private@example.com'}}))).status).toBe(200);
  const persisted=JSON.stringify(f.create.mock.calls);for(const value of ['0911111111','private@example.com',secret])expect(persisted).not.toContain(value);
 });
 it('bounds malformed and oversized raw requests before event persistence',async()=>{
  expect((await webhook(new Request(origin+'/api/payments/chapa/v1/webhook',{method:'POST',headers:{'content-length':'65537'},body:'x'.repeat(65537)}))).status).toBe(413);
  expect((await webhook(new Request(origin+'/api/payments/chapa/v1/webhook',{method:'POST',body:'{' }))).status).toBe(401);
  expect(f.transaction).not.toHaveBeenCalled();
 });
 it('treats v1 callbacks as unsigned navigation only and never as payment proof',async()=>{
  expect((await callbackPost()).status).toBe(202);
  const response=await callback(new Request(origin+'/api/payments/chapa/v1/callback?checkout='+id+'&status=success&redirect=https://foreign.test'));
  expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(origin+'/payments/chapa/return?checkout='+id);
  expect(f.transaction).not.toHaveBeenCalled();expect(f.process).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
});
