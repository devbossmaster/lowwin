import {createHmac,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({events:new Map<string,{payloadHash:string;requestId:string}>(),wakes:0,completions:0,requestBound:true}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(callback:(tx:unknown)=>Promise<unknown>)=>callback({
 verifyWebhookEvent:{findUnique:async({where}:{where:{id:string}})=>state.events.get(where.id)??null,create:async({data}:{data:{id:string;payloadHash:string;requestId:string}})=>{state.events.set(data.id,{payloadHash:data.payloadHash,requestId:data.requestId})}},
 verifyRequest:{updateMany:async()=>{state.wakes++}},
})}}));
vi.mock('@/modules/payments/service',()=>({completeVerifyWebhook:async()=>{state.completions++;return state.requestBound}}));
import {POST} from '../src/app/api/payments/verify-et/webhook/route';

const secret='whsec_fixture-secret';
function signed(payload:unknown,at=new Date().toISOString(),signatureSecret=secret){const body=JSON.stringify(payload),signature=createHmac('sha256',signatureSecret).update(`${at}.${body}`).digest('hex');return new Request('https://lowwin.example/api/payments/verify-et/webhook',{method:'POST',headers:{'content-type':'application/json','x-webhook-timestamp':at,'x-webhook-signature':`sha256=${signature}`,'x-webhook-event':'verification.completed','x-webhook-event-id':String((payload as {id?:string}).id)},body})}
beforeEach(()=>{state.events.clear();state.wakes=0;state.completions=0;state.requestBound=true;vi.stubEnv('VERIFY_ET_WEBHOOK_SECRET',secret);vi.stubEnv('VERIFY_ET_WEBHOOK_SECRET_PREVIOUS','');vi.spyOn(console,'info').mockImplementation(()=>{})});
afterEach(()=>{vi.restoreAllMocks()});
describe('Verify.et signed durable webhook',()=>{
 it('requests redelivery when completion precedes request binding, then handles the same event',async()=>{
  const payload={id:randomUUID(),event:'verification.completed',requestId:randomUUID(),data:{processingStatus:'completed',verified:true}};
  state.requestBound=false;
  const early=await POST(signed(payload));expect(early.status).toBe(503);expect(early.headers.get('retry-after')).toBe('30');expect(state.events.size).toBe(1);
  state.requestBound=true;
  expect((await POST(signed(payload))).status).toBe(204);expect(state.events.size).toBe(1);expect(state.completions).toBe(2);
 });
 it('persists completion before 204 and deduplicates retries, including early callbacks',async()=>{
  const payload={id:randomUUID(),event:'verification.completed',requestId:randomUUID(),timestamp:new Date().toISOString(),data:{processingStatus:'completed',verified:true}};
  expect((await POST(signed(payload))).status).toBe(204);expect(state.events.size).toBe(1);expect(state.wakes).toBe(1);expect(state.completions).toBe(1);
  expect((await POST(signed(payload))).status).toBe(204);expect(state.events.size).toBe(1);expect(state.wakes).toBe(1);expect(state.completions).toBe(2);
 });
 it('rejects forged and stale signatures',async()=>{const payload={id:randomUUID(),event:'verification.completed',requestId:randomUUID()};expect((await POST(signed(payload,new Date().toISOString(),'whsec_wrong'))).status).toBe(401);expect((await POST(signed(payload,new Date(Date.now()-3600000).toISOString()))).status).toBe(401);expect(state.events.size).toBe(0)});
 it('accepts rotation and signed test pings without a payment event',async()=>{vi.stubEnv('VERIFY_ET_WEBHOOK_SECRET_PREVIOUS','whsec_previous');const payload={id:randomUUID(),event:'webhook.test',requestId:randomUUID()};expect((await POST(signed(payload,new Date().toISOString(),'whsec_previous'))).status).toBe(204);expect(state.events.size).toBe(0)});
});

describe('Verify.et webhook diagnostics',()=>{
 it('logs arrival and response for one request without exposing request data',async()=>{
  const request=new Request('https://lowwin.example/api/payments/verify-et/webhook?private=query-sentinel',signed({event:'webhook.test',data:{senderName:'private-sender-sentinel',referenceNumber:'private-reference-sentinel'}}));
  request.headers.set('authorization','Bearer private-auth-sentinel');
  const signature=request.headers.get('x-webhook-signature')!;
  expect((await POST(request)).status).toBe(204);
  const lines=vi.mocked(console.info).mock.calls.map(call=>String(call[0]));
  expect(lines).toHaveLength(2);
  const [arrival,result]=lines.map(line=>JSON.parse(line));
  expect(arrival).toMatchObject({event:'verify_et_webhook_received',path:'/api/payments/verify-et/webhook'});
  expect(result).toMatchObject({event:'verify_et_webhook_response',traceId:arrival.traceId,status:204,outcome:'test_accepted',durationMs:expect.any(Number)});
  for(const sensitive of [secret,signature,'query-sentinel','private-sender-sentinel','private-reference-sentinel','private-auth-sentinel'])expect(lines.join('\n')).not.toContain(sensitive);
  expect(state.events.size).toBe(0);expect(state.completions).toBe(0);
 });
 it('logs a rejected signature and retryable request binding failure accurately',async()=>{
  const payload={id:randomUUID(),event:'verification.completed',requestId:randomUUID()};
  expect((await POST(signed(payload,new Date().toISOString(),'whsec_wrong'))).status).toBe(401);
  state.requestBound=false;
  expect((await POST(signed(payload))).status).toBe(503);
  const responses=vi.mocked(console.info).mock.calls.map(call=>JSON.parse(String(call[0]))).filter(line=>line.event==='verify_et_webhook_response');
  expect(responses).toEqual([expect.objectContaining({status:401,outcome:'signature_rejected'}),expect.objectContaining({status:503,outcome:'request_not_bound'})]);
  expect(state.completions).toBe(1);
 });
});
