import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const access=vi.hoisted(()=>({getMiniSession:vi.fn(),localMiniPreview:vi.fn(()=>false),signedSessionToken:vi.fn()}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:access.getMiniSession,localMiniPreview:access.localMiniPreview}));
vi.mock('../src/modules/auth/signed-session',()=>({signedSessionToken:access.signedSessionToken}));
import {proxy} from '../src/proxy';
import {customerLoginPath,customerLoginRequest,withoutCustomerLogin} from '../src/lib/customer-login-entry';
beforeEach(()=>{vi.clearAllMocks();access.localMiniPreview.mockReturnValue(false);access.getMiniSession.mockResolvedValue(null);access.signedSessionToken.mockResolvedValue(null)});
describe('Home and registered customer website boundary',()=>{
 it('redirects guests from the retired catalogue and preserves its signed-in 404',async()=>{
  const request=new NextRequest('https://lowwin.test/auctions/all');
  const guest=await proxy(request);expect(guest.status).toBe(307);
  expect(guest.headers.get('location')).toBe('https://lowwin.test/?login=1');
  access.getMiniSession.mockResolvedValue({user:{id:'verified-user'}});
  const signedIn=await proxy(request);expect(signedIn.status).toBe(404);expect(signedIn.headers.get('x-robots-tag')).toBe('noindex');
 });
 it.each(['/auctions','/auctions/item-42','/categories/accessories','/winners','/winners/42','/draws','/my-bids','/winning-bids','/profile','/profile/alerts','/profile/support','/wallet','/wallet/deposit','/payments','/faq','/terms','/privacy','/how-it-works'])('requires verified registration for %s',async path=>{
  const response=await proxy(new NextRequest('https://lowwin.test'+path+'?view=saved',{headers:{cookie:'forged-session=1','x-telegram-id':'123',RSC:'1','next-router-prefetch':'1'}})),url=new URL(response.headers.get('location')!);
  expect(response.status).toBe(307);expect(url.origin).toBe('https://lowwin.test');expect(url.pathname).toBe('/');expect(url.searchParams.get('login')).toBe('1');expect(url.searchParams.get('next')).toBe(path+'?view=saved');expect(response.headers.get('cache-control')).toContain('private, no-store');expect(access.getMiniSession).toHaveBeenCalledTimes(1);
 });
 it.each(['/','/api/catalog/auctions','/api/catalog/activity','/api/results/recent-winners'])('allows Home and its preview feed %s without account queries',async path=>{
  access.getMiniSession.mockRejectedValue(Error('Account unavailable'));const response=await proxy(new NextRequest('https://lowwin.test'+path));expect(response.headers.get('x-middleware-next')).toBe('1');expect(access.getMiniSession).not.toHaveBeenCalled();
 });
 it.each(['MINI_APP','TELEGRAM_OIDC'])('allows an independently validated %s account',async source=>{
  access.getMiniSession.mockResolvedValue({user:{id:'verified-user'},session:{telegramAuthSource:source}});
  for(const path of ['/auctions/item-42','/categories/accessories','/winners/42','/profile','/faq','/payments/chapa/return'])expect((await proxy(new NextRequest('https://lowwin.test'+path))).headers.get('x-middleware-next')).toBe('1');
 });
 it('uses Home to authenticate a payment return while preserving the owned checkout link',async()=>{
  const path='/payments/chapa/return?checkout=11111111-1111-4111-a111-111111111111';
  const response=await proxy(new NextRequest('https://lowwin.test'+path));
  const destination=new URL(response.headers.get('location')!);
  expect(response.status).toBe(307);expect(destination.pathname).toBe('/');
  expect(customerLoginRequest(destination.searchParams)).toEqual({destination:path});
 });
 it('redirects an unverified staff subpage visit to the staff entry and leaves role checks to the staff layout',async()=>{
  const url='https://lowwin.test/admin/users';
  const request=new NextRequest(url,{headers:{cookie:'forged-session=1'}});
  const guest=await proxy(request);
  expect(guest.status).toBe(307);expect(guest.headers.get('location')).toBe('https://lowwin.test/admin');
  access.signedSessionToken.mockResolvedValue('signed-session-token');
  const candidate=await proxy(request);
  expect(candidate.headers.get('x-middleware-next')).toBe('1');expect(candidate.headers.get('cache-control')).toContain('no-store');
  expect(access.getMiniSession).not.toHaveBeenCalled();
 });
 it('keeps database outages distinct from missing registration',async()=>{
  access.getMiniSession.mockRejectedValue({code:'P1001'});const response=await proxy(new NextRequest('https://lowwin.test/winners/42'));expect(response.status).toBe(503);expect(response.headers.get('location')).toBeNull();expect(response.headers.get('retry-after')).toBe('5');
 });
 it('leaves Home, login/onboarding, staff authentication and signed delivery infrastructure independent',async()=>{
  access.getMiniSession.mockRejectedValue(Error('Customer lookup must not run'));
  for(const path of ['/','/telegram','/admin','/admin/login','/api/admin/auctions','/api/auth/telegram/config','/api/auth/sign-in/social','/api/auth/callback/telegram-oidc','/api/onboarding/contact','/api/bot/webhook','/api/payments/chapa/webhook','/api/payments/chapa/callback','/api/health/live','/api/catalog/auctions','/api/catalog/categories','/api/catalog/activity','/api/results/winners'])expect((await proxy(new NextRequest('https://lowwin.test'+path))).headers.get('x-middleware-next')).toBe('1');
  expect(access.getMiniSession).not.toHaveBeenCalled();
 });
 it('keeps the registration destination strictly within customer routes',()=>{
  for(const next of ['https://evil.test','//evil.test','/admin','/api/me','/telegram?next=/admin','/profile/../admin']){const params=new URL(customerLoginPath(next),'https://lowwin.test').searchParams;expect(params.get('next')).toBeNull();expect(customerLoginRequest(params)).toEqual({destination:'/'});}
  const next='/auctions/42?coupon=selected#bid-review',params=new URL(customerLoginPath(next),'https://lowwin.test').searchParams;expect(customerLoginRequest(params)).toEqual({destination:next});expect(customerLoginRequest(new URLSearchParams('login=1&login=1&next=/profile'))).toBeNull();expect(customerLoginRequest(new URLSearchParams('login=1&next=/profile&next=/payments'))).toBeNull();
  expect(withoutCustomerLogin('https://lowwin.test/?q=phone&login=1&next=%2Fprofile#discover')).toBe('/?q=phone#discover');
 });
});
