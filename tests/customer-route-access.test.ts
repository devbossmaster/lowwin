import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const access=vi.hoisted(()=>({getMiniSession:vi.fn(),localMiniPreview:vi.fn(()=>false)}));
vi.mock('../src/modules/auth/mini-access',()=>access);
import {proxy} from '../src/proxy';
import {customerLoginPath,customerLoginRequest,withoutCustomerLogin} from '../src/lib/customer-login-entry';
beforeEach(()=>{vi.clearAllMocks();access.localMiniPreview.mockReturnValue(false);access.getMiniSession.mockResolvedValue(null)});
describe('public products and registered customer website boundary',()=>{
 it.each(['/winners','/winners/42','/draws','/my-bids','/winning-bids','/profile','/profile/alerts','/profile/support','/wallet','/wallet/deposit','/payments','/faq','/terms','/privacy','/how-it-works'])('requires verified registration for %s',async path=>{
  const response=await proxy(new NextRequest('https://lowwin.test'+path+'?view=saved',{headers:{cookie:'forged-session=1','x-telegram-id':'123',RSC:'1','next-router-prefetch':'1'}})),url=new URL(response.headers.get('location')!);
  expect(response.status).toBe(307);expect(url.origin).toBe('https://lowwin.test');expect(url.pathname).toBe('/');expect(url.searchParams.get('login')).toBe('1');expect(url.searchParams.get('next')).toBe(path+'?view=saved');expect(response.headers.get('cache-control')).toContain('private, no-store');expect(access.getMiniSession).toHaveBeenCalledTimes(1);
 });
 it.each(['/auctions','/auctions/all','/auctions/item-42','/categories/accessories','/api/catalog/auctions/item-42'])('allows read-only public product browsing on %s without account queries',async path=>{
  access.getMiniSession.mockRejectedValue(Error('Account unavailable'));const response=await proxy(new NextRequest('https://lowwin.test'+path));expect(response.headers.get('x-middleware-next')).toBe('1');expect(access.getMiniSession).not.toHaveBeenCalled();
 });
 it.each(['MINI_APP','TELEGRAM_OIDC'])('allows an independently validated %s account',async source=>{
  access.getMiniSession.mockResolvedValue({user:{id:'verified-user'},session:{telegramAuthSource:source}});
  for(const path of ['/winners/42','/profile','/faq'])expect((await proxy(new NextRequest('https://lowwin.test'+path))).headers.get('x-middleware-next')).toBe('1');
 });
 it('keeps database outages distinct from missing registration',async()=>{
  access.getMiniSession.mockRejectedValue({code:'P1001'});const response=await proxy(new NextRequest('https://lowwin.test/winners/42'));expect(response.status).toBe(503);expect(response.headers.get('location')).toBeNull();expect(response.headers.get('retry-after')).toBe('5');
 });
 it('leaves Home, login/onboarding, staff authentication and signed delivery infrastructure independent',async()=>{
  access.getMiniSession.mockRejectedValue(Error('Customer lookup must not run'));
  for(const path of ['/','/telegram','/admin','/admin/login','/api/admin/auctions','/api/auth/telegram/browser/config','/api/auth/telegram/browser/start','/api/auth/telegram/browser/callback','/api/onboarding/contact','/api/bot/webhook','/api/payments/chapa/webhook','/payments/chapa/return','/api/health/live','/api/catalog/auctions','/api/catalog/categories','/api/catalog/activity','/api/results/winners'])expect((await proxy(new NextRequest('https://lowwin.test'+path))).headers.get('x-middleware-next')).toBe('1');
  expect(access.getMiniSession).not.toHaveBeenCalled();
 });
 it('keeps the registration destination strictly within customer routes',()=>{
  for(const next of ['https://evil.test','//evil.test','/admin','/api/me','/telegram?next=/admin','/profile/../admin']){const params=new URL(customerLoginPath(next),'https://lowwin.test').searchParams;expect(params.get('next')).toBeNull();expect(customerLoginRequest(params)).toEqual({destination:'/'});}
  const next='/auctions/42?coupon=selected#bid-review',params=new URL(customerLoginPath(next),'https://lowwin.test').searchParams;expect(customerLoginRequest(params)).toEqual({destination:next});expect(customerLoginRequest(new URLSearchParams('login=1&login=1&next=/profile'))).toBeNull();expect(customerLoginRequest(new URLSearchParams('login=1&next=/profile&next=/payments'))).toBeNull();
  expect(withoutCustomerLogin('https://lowwin.test/?q=phone&login=1&next=%2Fprofile#discover')).toBe('/?q=phone#discover');
 });
});
