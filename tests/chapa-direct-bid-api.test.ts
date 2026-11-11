import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),prepare:vi.fn()}));
vi.mock('../src/modules/payments/session',()=>({requirePaymentSession:f.auth}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.user}));
vi.mock('../src/modules/payments/chapa-direct',()=>({createBidDirectCheckout:f.prepare,createDirectCheckout:f.prepare,getChapaMethods:f.prepare}));
import {POST as bidDirect} from '../src/app/api/payments/chapa/direct/bid/route';
import {POST as topupDirect} from '../src/app/api/payments/chapa/direct/route';
import {GET as methods} from '../src/app/api/payments/chapa/methods/route';
import {PrivateApiError} from '../src/modules/auth/private-api';
const origin='https://lowwin.test';
const request=(path:string,from=origin,body='{"paymentMethod":"telebirr","phone":"0911111111"}')=>new Request(origin+path,{method:'POST',headers:{origin:from,'Content-Type':'application/json'},body});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BETTER_AUTH_URL',origin);f.auth.mockResolvedValue({userId:'signed-in-owner'});f.user.mockResolvedValue('signed-in-owner')});
afterEach(()=>vi.unstubAllEnvs());
describe('retired direct-creation HTTP boundaries',()=>{
 it.each([['bid',bidDirect],['top-up',topupDirect]] as const)('returns an authenticated private 410 for new %s direct payments without parsing customer data',async(_label,post)=>{
  const response=await post(request('/api/payments/chapa/direct','https://lowwin.test','{invalid'));
  expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'HOSTED_CHECKOUT_REQUIRED'});expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('server-timing')).toContain('auth;dur=');expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each([bidDirect,topupDirect])('rejects a foreign origin before authentication',async post=>{
  expect((await post(request('/api/payments/chapa/direct','https://foreign.test'))).status).toBe(403);expect(f.auth).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it.each([bidDirect,topupDirect])('requires a session before revealing the retired payment boundary',async post=>{
  f.auth.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));expect((await post(request('/api/payments/chapa/direct'))).status).toBe(401);expect(f.prepare).not.toHaveBeenCalled();
 });
 it('moves method selection onto hosted checkout and keeps the response private',async()=>{
  const response=await methods(new Request(origin+'/api/payments/chapa/methods'));expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'HOSTED_CHECKOUT_REQUIRED'});expect(response.headers.get('cache-control')).toContain('private, no-store');expect(f.prepare).not.toHaveBeenCalled();
  f.user.mockRejectedValue(new PrivateApiError(401,'Sign in'));expect((await methods(new Request(origin+'/api/payments/chapa/methods'))).status).toBe(401);
 });
});
