import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const access=vi.hoisted(()=>({getMiniSession:vi.fn(),localMiniPreview:vi.fn(()=>false)}));
vi.mock('../src/modules/auth/mini-access',()=>access);
import {proxy} from '../src/proxy';
beforeEach(()=>{vi.clearAllMocks();access.getMiniSession.mockReset()});
describe('private access during database outages',()=>{
  it('leaves only exact Chapa callbacks public and delegates private checkout auth to its handlers',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const path of ['/payments/chapa/return','/api/payments/chapa/callback','/api/payments/chapa/webhook','/api/payments/chapa','/api/payments/chapa/checkouts','/api/payments/chapa/checkouts/11111111-1111-4111-a111-111111111111'])expect((await proxy(new NextRequest('http://localhost'+path))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/payments/chapa/webhook/extra','/api/payments/chapa/callback/extra','/api/payments/chapa/checkouts/not-a-uuid','/api/payments/chapa/checkouts/11111111-1111-4111-a111-111111111111/extra'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(401);
  });
  it('preserves a customer deep link through the Telegram entry without allowing other destinations',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    const response=await proxy(new NextRequest('https://localhost/auctions/123?checkout=11111111-1111-4111-a111-111111111111'));
    const location=new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/telegram');expect(location.searchParams.get('next')).toBe('/auctions/123?checkout=11111111-1111-4111-a111-111111111111');
  });
  it('does not run database auth for known public assets or already guarded APIs',async()=>{
    access.getMiniSession.mockRejectedValue(new Error('Private authentication is unavailable'));
    for(const path of ['/logo.png','/banner11.png','/images/lowin-family-hero.webp','/fonts/dm-sans-latin-400.woff2','/fonts/dm-sans-latin-500.woff2','/fonts/dm-sans-latin-600.woff2','/fonts/dm-sans-latin-700.woff2','/fonts/noto-sans-ethiopic-variable.woff2','/api/payments/arifpay','/api/payments/arifpay/checkouts','/api/payments/arifpay/checkouts/11111111-1111-4111-a111-111111111111','/api/payments/arifpay/webhook','/api/media/11111111-1111-4111-a111-111111111111','/fonts/poppins-latin-400.woff2','/api/favorites','/api/favorites/phone','/api/my-bids','/api/alerts?summary=1','/api/auctions/phone/bids','/api/payments/verify-et/webhook']){
      expect((await proxy(new NextRequest(`http://localhost${path}`))).headers.get('x-middleware-next')).toBe('1');
    }
    expect(access.getMiniSession).not.toHaveBeenCalled();
  });
  it('keeps unmatched API paths and private media protected',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/favorites/phone/private','/api/media/123','/private.png','/images/private.webp','/images/lowin-family-hero.webp/private','/fonts/private.woff2','/fonts/dm-sans-latin-400.woff2/private','/api/payments/arifpay/checkouts/11111111-1111-4111-a111-111111111111/private','/api/payments/arifpay/webhook/private','/api/catalog/auctions','/api/payments/verify-et/webhook/extra','/webhooks/verify','/webhooks/verify/extra','/webhooks/other'])expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(path.startsWith('/api/')?401:307);
  });
  it('keeps an unavailable session check closed and tells APIs to retry',async()=>{
    access.getMiniSession.mockRejectedValue({code:'P1001'});
    const response=await proxy(new NextRequest('http://localhost/api/results'));
    expect(response.status).toBe(503);expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({error:'Connection interrupted. Please retry.'});
  });
  it('still denies unauthenticated API requests',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    expect((await proxy(new NextRequest('http://localhost/api/results'))).status).toBe(401);
  });
  it('offers retry without a sign-in redirect during an outage',async()=>{
    access.getMiniSession.mockRejectedValue({code:'P1001'});
    const response=await proxy(new NextRequest('http://localhost/profile'));
    expect(response.status).toBe(503);expect(response.headers.get('location')).toBeNull();expect(await response.text()).toContain('Retry');
  });
  it('allows a verified session and leaves public entry available without database work',async()=>{
    access.getMiniSession.mockResolvedValue({user:{id:'verified'}});
    expect((await proxy(new NextRequest('http://localhost/api/results'))).headers.get('x-middleware-next')).toBe('1');
    access.getMiniSession.mockClear();
    expect((await proxy(new NextRequest('http://localhost/telegram'))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();
  });
});
