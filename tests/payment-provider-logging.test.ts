import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkEt,type VerificationInput} from '../src/modules/payments/provider';
const input:VerificationInput={bank:'telebirr',reference:'SECRETREF123',account:'0912345678',expectedCents:1000n,createdAt:new Date(),expiresAt:new Date()};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('provider diagnostics',()=>{
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
