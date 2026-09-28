import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const access=vi.hoisted(()=>({getMiniSession:vi.fn(),localMiniPreview:vi.fn(()=>false)}));
vi.mock('../src/modules/auth/mini-access',()=>access);
import {proxy} from '../src/proxy';
beforeEach(()=>{vi.clearAllMocks();access.getMiniSession.mockReset()});
describe('private access during database outages',()=>{
  it('does not run database auth for known public assets or already guarded APIs',async()=>{
    for(const path of ['/banner1.png','/fonts/poppins-latin-400.woff2','/api/favorites','/api/favorites/phone','/api/my-bids','/api/alerts?summary=1','/api/auctions/phone/bids']){
      expect((await proxy(new NextRequest(`http://localhost${path}`))).headers.get('x-middleware-next')).toBe('1');
    }
    expect(access.getMiniSession).not.toHaveBeenCalled();
  });
  it('keeps unmatched API paths and private media protected',async()=>{
    access.getMiniSession.mockResolvedValue(null);
    for(const path of ['/api/favorites/phone/private','/api/media/123','/private.png','/api/catalog/auctions'])expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(path.startsWith('/api/')?401:307);
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
