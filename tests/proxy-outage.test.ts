import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const access=vi.hoisted(()=>({getMiniSession:vi.fn(),localMiniPreview:vi.fn(()=>false)}));
vi.mock('../src/modules/auth/mini-access',()=>access);
import {proxy} from '../src/proxy';
beforeEach(()=>{vi.clearAllMocks();access.getMiniSession.mockReset()});
describe('private access during database outages',()=>{
  it('serves only the three public guide illustrations without authentication',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const name of ['choose-number','pay-entry','winning-result'])for(const method of ['GET','HEAD'])expect((await proxy(new NextRequest(`http://localhost/images/how-it-works/${name}.svg`,{method}))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/images/how-it-works/private.svg','/images/how-it-works/choose-number.svg/private'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(307);
  });
  it('serves the exact self-hosted Inter font without widening private asset access',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const method of ['GET','HEAD'])expect((await proxy(new NextRequest('http://localhost/fonts/inter-latin-variable.woff2',{method}))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/fonts/inter-latin-variable.woff2/private','/fonts/private-inter.woff2'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(307);
  });
  it('serves the public November hero during an auth outage without exposing nearby private paths',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const method of ['GET','HEAD'])expect((await proxy(new NextRequest('http://localhost/images/lowwin-violet-hero-20261113.webp',{method}))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/images/lowwin-violet-hero-20261113.webp/private','/images/private-winner.webp'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(307);
  });
  it('serves only the approved CBE video without database auth, including range requests',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const method of ['GET','HEAD'])expect((await proxy(new NextRequest('http://localhost/video/cbe-bank-payment.mp4',{method,headers:{Range:'bytes=0-1023'}}))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/video/private.mp4','/video/cbe-bank-payment.mp4/private'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(307);
  });
  it('serves the exact public Chapa logo without a database lookup',async()=>{access.getMiniSession.mockRejectedValue(Error('Database unavailable'));expect((await proxy(new NextRequest('http://localhost/images/chapa-logo.svg'))).headers.get('x-middleware-next')).toBe('1');expect(access.getMiniSession).not.toHaveBeenCalled();access.getMiniSession.mockResolvedValue(null);expect((await proxy(new NextRequest('http://localhost/images/chapa-logo.svg/private'))).status).toBe(307)});
  it('leaves only exact Chapa callbacks public and delegates private checkout auth to its handlers',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Database unavailable'));
    for(const path of ['/payments/chapa/return','/api/payments/chapa/callback','/api/payments/chapa/webhook','/api/payments/chapa','/api/payments/chapa/checkouts','/api/payments/chapa/checkouts/11111111-1111-4111-a111-111111111111'])expect((await proxy(new NextRequest('http://localhost'+path))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/payments/chapa/webhook/extra','/api/payments/chapa/callback/extra','/api/payments/chapa/checkouts/not-a-uuid','/api/payments/chapa/checkouts/11111111-1111-4111-a111-111111111111/extra'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(401);
  });
  it('requires registered identity for a result deep link and preserves a safe return on Home',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    const response=await proxy(new NextRequest('https://localhost/winners/123?view=all'));
    const location=new URL(response.headers.get('location')!);expect(response.status).toBe(307);expect(location.pathname).toBe('/');expect(location.searchParams.get('login')).toBe('1');expect(location.searchParams.get('next')).toBe('/winners/123?view=all');expect(access.getMiniSession).toHaveBeenCalledTimes(1);
  });
  it('delegates exact direct-charge routes to their session-guarded handlers without a duplicate auth read',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Private authentication is unavailable'));
    const id='11111111-1111-4111-a111-111111111111';
    for(const path of ['/api/payments/chapa/direct','/api/payments/chapa/methods?amountCents=1000','/api/payments/chapa/batches/quote',`/api/payments/chapa/batches/${id}/wallet`,`/api/payments/chapa/checkouts/${id}/authorize`])expect((await proxy(new NextRequest('http://localhost'+path))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/payments/chapa/direct/extra','/api/payments/chapa/batches/not-a-uuid/wallet',`/api/payments/chapa/checkouts/${id}/authorize/extra`])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(401);
  });
  it('does not run database auth for known public assets or already guarded APIs',async()=>{
    access.getMiniSession.mockRejectedValue(new Error('Private authentication is unavailable'));
    for(const path of ['/logo.png','/banner11.png','/images/lowin-family-hero.webp','/fonts/dm-sans-latin-400.woff2','/fonts/dm-sans-latin-500.woff2','/fonts/dm-sans-latin-600.woff2','/fonts/dm-sans-latin-700.woff2','/fonts/noto-sans-ethiopic-variable.woff2','/api/payments/arifpay','/api/payments/arifpay/checkouts','/api/payments/arifpay/checkouts/11111111-1111-4111-a111-111111111111','/api/payments/arifpay/webhook','/api/media/11111111-1111-4111-a111-111111111111','/fonts/poppins-latin-400.woff2','/api/favorites','/api/favorites/phone','/api/my-bids','/api/alerts?summary=1','/api/auctions/phone/bids','/api/payments/verify-et/webhook']){
      expect((await proxy(new NextRequest(`http://localhost${path}`))).headers.get('x-middleware-next')).toBe('1');
    }
    expect(access.getMiniSession).not.toHaveBeenCalled();
  });
  it('delegates only exact transaction routes to their owner-guarded handlers',async()=>{
    access.getMiniSession.mockRejectedValue(Error('Private authentication is unavailable'));
    for(const path of ['/api/transactions?type=BID','/api/transactions/wallet/11111111-1111-4111-a111-111111111111'])expect((await proxy(new NextRequest('http://localhost'+path))).headers.get('x-middleware-next')).toBe('1');
    expect(access.getMiniSession).not.toHaveBeenCalled();access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/transactions/extra','/api/transactions/wallet/not-an-id','/api/transactions/wallet/11111111-1111-4111-a111-111111111111/extra'])expect((await proxy(new NextRequest('http://localhost'+path))).status).toBe(401);
  });
  it('keeps unmatched API paths and private media protected',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/favorites/phone/private','/api/media/123','/private.png','/images/private.webp','/images/lowin-family-hero.webp/private','/fonts/private.woff2','/fonts/dm-sans-latin-400.woff2/private','/api/payments/arifpay/checkouts/11111111-1111-4111-a111-111111111111/private','/api/payments/arifpay/webhook/private','/api/payments/verify-et/webhook/extra','/webhooks/verify','/webhooks/verify/extra','/webhooks/other'])expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(path.startsWith('/api/')?401:307);
  });
  it('keeps an unavailable session check closed and tells APIs to retry',async()=>{
    access.getMiniSession.mockRejectedValue({code:'P1001'});
    const response=await proxy(new NextRequest('http://localhost/api/private-unknown'));
    expect(response.status).toBe(503);expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({error:'Connection interrupted. Please retry.'});
  });
  it('still denies unauthenticated API requests',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    expect((await proxy(new NextRequest('http://localhost/api/private-unknown'))).status).toBe(401);
  });
  it('offers retry without a sign-in redirect during an outage',async()=>{
    access.getMiniSession.mockRejectedValue({code:'P1001'});
    const response=await proxy(new NextRequest('http://localhost/private-unknown'));
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
