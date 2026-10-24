import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),count:vi.fn(),findMany:vi.fn(),preferences:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{notificationInbox:{count:mocks.count,findMany:mocks.findMany},notificationPreference:{findUnique:mocks.preferences}}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:mocks.session}));
vi.mock('../src/modules/notifications/service',()=>({defaultPreferences:{inApp:true,telegram:false,auctionStart:true,favoriteEnding:true,fulfillment:true}}));
import {GET} from '../src/app/api/alerts/route';
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockReset().mockResolvedValue({user:{id:'player-a'}});mocks.count.mockReset().mockResolvedValue(3)});
describe('lightweight alert count',()=>{
  it('still denies direct unauthenticated requests without reading private data',async()=>{
    mocks.session.mockResolvedValue(null);
    const response=await GET(new Request('http://localhost/api/alerts?summary=1'));
    expect(response.status).toBe(401);expect(mocks.count).not.toHaveBeenCalled();expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('counts only the current player unread rows without fetching the inbox',async()=>{
    const response=await GET(new Request('http://localhost/api/alerts?summary=1'));
    expect(await response.json()).toEqual({unread:3});expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith({where:{AND:[{userId:'player-a',readAt:null},{NOT:{OR:[{kind:{startsWith:'DEPOSIT_'}},{kind:{startsWith:'TOPUP_'}}]}}]}});
    expect(mocks.findMany).not.toHaveBeenCalled();expect(mocks.preferences).not.toHaveBeenCalled();
  });
  it('returns retryable failure instead of authorizing when the session database is busy',async()=>{
    mocks.session.mockRejectedValue({code:'P2024'});
    expect((await GET(new Request('http://localhost/api/alerts?summary=1'))).status).toBe(503);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
