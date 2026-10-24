import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {PrivateApiError} from '../src/modules/auth/private-api';

const fixture=vi.hoisted(()=>({authorize:vi.fn(),reauthorize:vi.fn(),create:vi.fn(),verify:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/payments/session',()=>({requirePaymentSession:fixture.authorize}));
vi.mock('../src/modules/payments/provider',async()=>({PaymentError:(await import('../src/modules/payments/reference')).PaymentError}));
vi.mock('../src/modules/payments/service',()=>({createIntent:fixture.create,verifyIntent:fixture.verify,fundingOptions:vi.fn(),listOwnTopups:vi.fn(),getOwnTopup:vi.fn()}));
import {POST} from '../src/app/api/wallet/top-ups/route';

const request=(action:string,origin='https://lowin.example')=>new Request('https://lowin.example/api/wallet/top-ups',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,input:{id:'existing-payment'}})});
describe('public deposit creation retirement',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL','https://lowin.example');fixture.authorize.mockResolvedValue({userId:'fixture-customer',reauthorize:fixture.reauthorize});fixture.verify.mockResolvedValue({status:'VERIFYING',id:'existing-payment'})});
 afterEach(()=>vi.unstubAllEnvs());
 it.each(['create','prepare'])('retires %s after authentication without creating a payment or touching the ledger',async action=>{
  const response=await POST(request(action));expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'DEPOSITS_RETIRED'});
  expect(response.headers.get('cache-control')).toContain('no-store');expect(fixture.authorize).toHaveBeenCalledOnce();expect(fixture.create).not.toHaveBeenCalled();expect(fixture.verify).not.toHaveBeenCalled();
 });
 it('keeps existing deposit verification and transactional reauthorization reachable',async()=>{
  const response=await POST(request('verify'));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'VERIFYING'});
  expect(fixture.verify).toHaveBeenCalledWith({},'fixture-customer',{id:'existing-payment'},undefined,fixture.reauthorize);expect(fixture.create).not.toHaveBeenCalled();
 });
 it('does not bypass the Telegram/contact-bound payment session for retired requests',async()=>{
  fixture.authorize.mockRejectedValueOnce(new PrivateApiError(401,'Sign in through Telegram.'));
  expect((await POST(request('prepare'))).status).toBe(401);expect(fixture.create).not.toHaveBeenCalled();expect(fixture.verify).not.toHaveBeenCalled();
 });
 it('retains same-origin protection before the payment session lookup',async()=>{
  expect((await POST(request('create','https://untrusted.example'))).status).toBe(403);expect(fixture.authorize).not.toHaveBeenCalled();expect(fixture.create).not.toHaveBeenCalled();
 });
});
