import {afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),record:vi.fn(),limit:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:mocks.session}));
vi.mock('../src/lib/rate-limit',()=>({allowIdentityRequest:mocks.limit}));
vi.mock('../src/modules/auctions/activity',()=>({recordAuctionView:mocks.record}));
import {POST} from '../src/app/api/catalog/auctions/[slug]/view/route';
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs()});
const context={params:Promise.resolve({slug:'42'})};
function request(origin='https://lowwin.shop'){return new Request('https://lowwin.shop/api/catalog/auctions/42/view',{method:'POST',headers:{origin}})}
describe('qualified auction view mutation',()=>{
 it('rejects an unauthenticated viewer without incrementing the counter',async()=>{
  vi.stubEnv('BETTER_AUTH_URL','https://lowwin.shop');mocks.session.mockResolvedValue(null);
  expect((await POST(request(),context)).status).toBe(401);expect(mocks.record).not.toHaveBeenCalled();
 });
 it('rejects another origin before reading identity',async()=>{
  vi.stubEnv('BETTER_AUTH_URL','https://lowwin.shop');
  expect((await POST(request('https://other.test'),context)).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();
 });
 it('counts with the verified session identity and returns the durable deduplicated count',async()=>{
  vi.stubEnv('BETTER_AUTH_URL','https://lowwin.shop');mocks.session.mockResolvedValue({user:{id:'verified-person'}});mocks.limit.mockResolvedValue(true);mocks.record.mockResolvedValue({views:'12',counted:false});
  const response=await POST(request(),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({views:'12',counted:false});expect(mocks.record).toHaveBeenCalledWith({},'42','verified-person');expect(response.headers.get('cache-control')).toContain('no-store');
 });
});
