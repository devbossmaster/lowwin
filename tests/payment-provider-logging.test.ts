import {afterEach,describe,expect,it,vi} from 'vitest';
import {submitVerify,type VerificationInput} from '../src/modules/payments/provider';
const requestId='550e8400-e29b-41d4-a716-446655440000';
const input:VerificationInput={bank:'telebirr',reference:'SECRETREF123',account:'0912345678',expectedCents:null,minCents:100n,maxCents:2000n,createdAt:new Date(Date.now()-60000),expiresAt:new Date(Date.now()+60000),attemptKey:'stable-attempt'};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('Verify.et JSON transport',()=>{
 it('sends only JSON, bank fields, frozen receiver and stable key',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued',status:'pending',verified:false},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'PROCESSING',matched:false});
  const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://verify.et/api/verify?waitMs=5000');expect(options.headers).toMatchObject({'x-api-key':'private-key','Idempotency-Key':'stable-attempt','Content-Type':'application/json'});expect(JSON.parse(options.body)).toEqual({bank:'telebirr',transactionNumber:input.reference,settlementAccount:input.account});expect(options.body).not.toContain('image');
 });
 it('sends current CBE Receipt ID without suffix and legacy FT with suffix',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'queued'},data:[]},{status:202}));vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
  await submitVerify({...input,bank:'cbe',reference:'fHCxyExampleRcpt1',account:'1000303997441'});expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({bank:'cbe',reference:'fHCxyExampleRcpt1',settlementAccount:'1000303997441'});
  await submitVerify({...input,bank:'cbe',reference:'FT26EXAMPLE1',account:'1000303997441'});expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({bank:'cbe',reference:'FT26EXAMPLE1',suffix:'03997441',settlementAccount:'1000303997441'});
 });
 it.each([[401,'PROVIDER_AUTH'],[402,'PROVIDER_QUOTA'],[429,'PROVIDER_RATE_LIMIT'],[503,'PROVIDER_OUTAGE']] as const)('keeps HTTP %s diagnostics private',async(status,code)=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-provider-body',{status})));const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code,matched:false});const line=log.mock.calls[0][0];expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:status,code});for(const secret of [input.reference,input.account,'private-key','private-provider-body'])expect(line).not.toContain(secret);
 });
 it('accepts omitted currency under the ETB channel policy and logs its source without private data',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,referenceNumber:input.reference,receiverAccount:input.account,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'VERIFIED',matched:true,evidence:{currency:'ETB',currencySource:'channel_policy'}});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'VERIFIED',currencySource:'channel_policy'});
  expect(JSON.parse(line)).not.toHaveProperty('invalidFields');
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it.each([[null],[1],[true],[['ETB']],[{value:'ETB'}],['USD']] as const)('ignores provider currency %j and records only the application unit',async currency=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,currency,referenceNumber:input.reference,receiverAccount:input.account,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'VERIFIED',matched:true,evidence:{currency:'ETB',currencySource:'channel_policy'}});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'VERIFIED',currencySource:'channel_policy'});
  expect(JSON.parse(line)).not.toHaveProperty('invalidFields');
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it('still rejects malformed receiving-account evidence and logs only its safe type',async()=>{
  vi.stubEnv('VERIFY_ET_API_KEY','private-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({success:true,requestId,verification:{processingStatus:'completed',status:'success',verified:true},data:[{bank:'telebirr',status:'success',verified:true,amount:10,referenceNumber:input.reference,receiverAccount:null,timestamp:new Date().toISOString(),senderName:'private-sender'}]})));
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await submitVerify(input)).toMatchObject({code:'INCOMPLETE_EVIDENCE',matched:false});
  const line=log.mock.calls[0][0];
  expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:200,code:'INCOMPLETE_EVIDENCE',invalidFields:[{field:'data.0.receiverAccount',issue:'invalid_type',received:'null'}]});
  for(const secret of [input.reference,input.account,'private-key','private-sender',requestId])expect(line).not.toContain(secret);
 });
 it('does not log exception contents on timeout',async()=>{vi.stubEnv('VERIFY_ET_API_KEY','private-key');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('sensitive-url','TimeoutError')));const log=vi.spyOn(console,'warn').mockImplementation(()=>{});expect(await submitVerify(input)).toMatchObject({code:'PROVIDER_OUTAGE',matched:false});expect(log.mock.calls[0][0]).not.toContain('sensitive-url')});
});
