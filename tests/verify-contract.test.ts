import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {assess,readVerifyStatus,submitVerify,type VerificationInput} from '../src/modules/payments/provider';

const requestId='550e8400-e29b-41d4-a716-446655440000';
const anotherId='550e8400-e29b-41d4-a716-446655440001';
const now=new Date('2026-10-01T09:00:00Z');
const input:VerificationInput={bank:'telebirr',reference:'DEMOREFERENCE123',account:'0911111111',expectedCents:null,minCents:100n,maxCents:100000n,createdAt:new Date(now.getTime()-60000),expiresAt:new Date(now.getTime()+60000),attemptKey:'same-attempt-key'};
const errorBody=(code:string,retryable:boolean)=>({success:false,requestId,error:{code,retryable,message:'private-provider-message'}});

beforeEach(()=>{
 vi.stubEnv('VERIFY_ET_API_KEY','private-api-key');
 vi.stubEnv('VERIFY_ET_TEST_ENDPOINT','');
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.spyOn(console,'info').mockImplementation(()=>{});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()});

describe('Verify.et terminal and queued contract',()=>{
 it.each([
  ['not_found',false,'NOT_FOUND'],
  ['invalid_input',false,'INVALID_RECEIPT'],
  ['parse_error',false,'INCOMPLETE_EVIDENCE'],
  ['upstream_timeout',true,'PROVIDER_OUTAGE'],
  ['upstream_rate_limited',true,'PROVIDER_RATE_LIMIT'],
  ['upstream_unavailable',true,'PROVIDER_OUTAGE'],
  ['unknown',false,'PROVIDER_FAILED'],
 ] as const)('maps the documented %s error without inventing a queued result',(code,retryable,expected)=>{
  const result=assess(errorBody(code,retryable),input,now);
  expect(result).toMatchObject({requestId,code:expected,matched:false});
  expect(result.processing).not.toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-provider-message');
 });
 it.each([undefined,'unexpected'])('does not poll forever for processing state %s',processingStatus=>{
  const result=assess({success:true,requestId,...(processingStatus?{verification:{processingStatus}}:{})},input,now);
  expect(result).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  expect(result.processing).not.toBe(true);
 });
 it('keeps a valid 202 pending under the same provider request identity',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued'},data:[]},{status:202})));
  expect(await submitVerify(input)).toMatchObject({code:'PROCESSING',processing:true,matched:false,requestId});
 });
 it('never credits contradictory terminal success carried by HTTP 202',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:'10',receiverAccount:input.account,referenceNumber:input.reference,timestamp:now.toISOString()}]},{status:202})));
  const result=await submitVerify(input);
  expect(result).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  expect(result.processing).not.toBe(true);
 });
 it('does not replace a terminal error carried by HTTP 202 with PROCESSING',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,error:{code:'parse_error',retryable:false}},{status:202})));
  const result=await submitVerify(input);
  expect(result).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  expect(result.processing).not.toBe(true);
 });
 it.each([undefined,'not-a-uuid'])('holds HTTP 202 without a valid request identity: %s',async id=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId:id,verification:{processingStatus:'queued'},data:[]},{status:202})));
  const result=await submitVerify(input);
  expect(result).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  expect(result.processing).not.toBe(true);
 });
 it('does not retry HTTP 400 as a provider outage',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(errorBody('invalid_input',false),{status:400})));
  expect(await submitVerify(input)).toMatchObject({code:'INVALID_RECEIPT',matched:false});
 });
 it('retains the provider request created before an HTTP 503',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(errorBody('upstream_unavailable',true),{status:503,headers:{'Retry-After':'120'}})));
  expect(await submitVerify(input)).toMatchObject({code:'PROVIDER_OUTAGE',matched:false,requestId,retrySeconds:120});
 });
 it.each(['120','Thu, 01 Oct 2026 09:02:00 GMT'])('honors Retry-After %s',async retryAfter=>{
  vi.spyOn(Date,'now').mockReturnValue(now.getTime());
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(errorBody('upstream_rate_limited',true),{status:429,headers:{'Retry-After':retryAfter}})));
  expect(await submitVerify(input)).toMatchObject({code:'PROVIDER_RATE_LIMIT',matched:false,retrySeconds:120});
 });
});

describe('Verify.et authenticated status polling',()=>{
 it('allows stable-key result replay only after a correlated terminal success',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,data:{requestId,processingStatus:'completed',status:'success',verified:true}})));
  expect(await readVerifyStatus(requestId)).toBeNull();
 });
 it('keeps a correlated running request pending',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,data:{requestId,processingStatus:'running',status:'pending',verified:false}})));
  expect(await readVerifyStatus(requestId)).toMatchObject({code:'PROCESSING',processing:true,matched:false,requestId});
 });
 it.each([undefined,anotherId])('rejects a status response with mismatched or missing identity: %s',async id=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,data:{requestId:id,processingStatus:'completed',status:'success',verified:true}})));
  expect(await readVerifyStatus(requestId)).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
 });
 it('returns a terminal parse failure rather than asking for another submission',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,data:{requestId,processingStatus:'failed',status:'failed',verified:false,error:{code:'parse_error',retryable:false}}})));
  const result=await readVerifyStatus(requestId);
  expect(result).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  expect(result?.processing).not.toBe(true);
 });
 it('returns the provider cooldown on HTTP 429 instead of throwing into a resubmit',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(errorBody('upstream_rate_limited',true),{status:429,headers:{'Retry-After':'180'}})));
  expect(await readVerifyStatus(requestId)).toMatchObject({code:'PROVIDER_RATE_LIMIT',matched:false,retrySeconds:180});
 });
});
