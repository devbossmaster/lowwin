import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkEt,type VerificationInput} from '../src/modules/payments/provider';
const input:VerificationInput={bank:'telebirr',reference:'SECRETREF123',account:'0912345678',expectedCents:1000n,createdAt:new Date(),expiresAt:new Date()};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('provider diagnostics',()=>{
 it('accepts a valid provider response taking longer than the old twelve-second deadline',async()=>{
  vi.useFakeTimers();vi.stubEnv('CHECK_ET_MODE','live');vi.stubEnv('CHECK_ET_LIVE_API_KEY','private-key');vi.stubEnv('CHECK_ET_TEST_ENDPOINT','');
  vi.spyOn(console,'info').mockImplementation(()=>{});
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('timeout','TimeoutError')),ms);return controller.signal});
  const now=new Date(),request={...input,createdAt:new Date(now.getTime()-1000),expiresAt:new Date(now.getTime()+60000)};
  vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise<Response>((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(options.signal.reason));
   setTimeout(()=>resolve(Response.json({success:true,exists:true,duplicate:false,data:{bank:input.bank,transaction_number:input.reference,verification_method:'official',receipt:{status:'completed',transaction_type:'transfer',amount:'10.00',currency:'ETB',transaction_date:now.toISOString(),receiver_account:input.account}}})),20000);
  })));
  const result=checkEt(request);await vi.advanceTimersByTimeAsync(20000);
  expect(await result).toMatchObject({code:'VERIFIED',matched:true});
 });
 it.each([[401,'PROVIDER_AUTH'],[402,'PROVIDER_QUOTA'],[429,'PROVIDER_RATE_LIMIT'],[503,'PROVIDER_OUTAGE']] as const)('logs HTTP %s without payment or key data',async(status,code)=>{
  vi.stubEnv('CHECK_ET_MODE','live');vi.stubEnv('CHECK_ET_LIVE_API_KEY','private-key');vi.stubEnv('CHECK_ET_TEST_ENDPOINT','');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-provider-body',{status})));
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await checkEt(input)).toMatchObject({code,matched:false});
  const line=log.mock.calls[0][0];expect(JSON.parse(line)).toMatchObject({event:'payment_provider_verification',httpStatus:status,code});
  for(const secret of [input.reference,input.account,'private-key','private-provider-body'])expect(line).not.toContain(secret);
 });
 it('identifies timeouts without exposing exception messages',async()=>{
  vi.stubEnv('CHECK_ET_MODE','live');vi.stubEnv('CHECK_ET_LIVE_API_KEY','private-key');vi.stubEnv('CHECK_ET_TEST_ENDPOINT','');
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('sensitive-url','TimeoutError')));
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(await checkEt(input)).toMatchObject({code:'PROVIDER_OUTAGE',matched:false});
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({failure:'TIMEOUT'});
  expect(log.mock.calls[0][0]).not.toContain('sensitive-url');
 });
});
