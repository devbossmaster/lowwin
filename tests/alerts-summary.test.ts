import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),count:vi.fn(),findMany:vi.fn(),preferences:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{notificationInbox:{count:mocks.count,findMany:mocks.findMany},notificationPreference:{findUnique:mocks.preferences}}}));
vi.mock('../src/modules/auth/mini-access',()=>({getMiniSession:mocks.session}));
vi.mock('../src/modules/notifications/service',()=>({defaultPreferences:{inApp:true,telegram:false,auctionStart:true,favoriteEnding:true,fulfillment:true}}));
import {GET} from '../src/app/api/alerts/route';
import {automaticNotificationKinds} from '../src/modules/notifications/policy';
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockReset().mockResolvedValue({user:{id:'player-a'}});mocks.count.mockReset().mockResolvedValue(3);mocks.findMany.mockReset().mockResolvedValue([])});
describe('lightweight alert count',()=>{
  it('still denies direct unauthenticated requests without reading private data',async()=>{
    mocks.session.mockResolvedValue(null);
    const response=await GET(new Request('http://localhost/api/alerts?summary=1'));
    expect(response.status).toBe(401);expect(mocks.count).not.toHaveBeenCalled();expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('counts only the current player unread rows without fetching the inbox',async()=>{
    const response=await GET(new Request('http://localhost/api/alerts?summary=1'));
    expect(await response.json()).toEqual({unread:3});expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith({where:{AND:[{userId:'player-a',readAt:null},{kind:{in:[...automaticNotificationKinds]}}]}});
    expect(mocks.findMany).not.toHaveBeenCalled();expect(mocks.preferences).not.toHaveBeenCalled();
  });
  it('returns retryable failure instead of authorizing when the session database is busy',async()=>{
    mocks.session.mockRejectedValue({code:'P2024'});
    expect((await GET(new Request('http://localhost/api/alerts?summary=1'))).status).toBe(503);
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it('includes committed deposits and only the finalized notification types in the owned list',async()=>{
    const item={id:'receipt-1',kind:'DEPOSIT_CREDITED',title:'ገንዘብ ገብቷል',body:'25.50 ብር ወደ ዋሌትዎ ገብቷል።',href:'/wallet',readAt:null,createdAt:new Date().toISOString()};
    mocks.findMany.mockResolvedValue([item]);
    const response=await GET(new Request('http://localhost/api/alerts?category=payments'));
    expect(await response.json()).toMatchObject({items:[item],categories:['all','draws','payments']});
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{AND:[{userId:'player-a'},{kind:{in:[...automaticNotificationKinds]}},{kind:{in:['DEPOSIT_CREDITED','BID_ACCEPTED']}}]}}));
  });
  it('does not expose retired automatic kinds or a manual-broadcast inbox category',async()=>{
    const response=await GET(new Request('http://localhost/api/alerts'));
    expect((await response.json()).categories).not.toContain('promotions');
    const filter=mocks.findMany.mock.calls[0][0].where.AND[1].kind.in;
    expect(filter).not.toContain('BROADCAST');expect(filter).not.toContain('AUCTION_RESULT');expect(filter).not.toContain('CONTACT_CONFIRMED');
  });
  it('removes the legacy offset label from stored auction alerts and keeps the Addis time',async()=>{
    const item={id:'auction-1',kind:'AUCTION_UPCOMING_ADDED',title:'አዲስ መጪ ጨረታ',body:'የሚጀምርበት፦ 25 ኖቬም 2026 22:00 (አዲስ አበባ · GMT+3)',href:'/auctions/8',readAt:null,createdAt:new Date().toISOString()};
    mocks.findMany.mockResolvedValue([item]);
    const response=await GET(new Request('http://localhost/api/alerts'));
    expect(await response.json()).toMatchObject({items:[{...item,body:'የሚጀምርበት፦ 25 ኖቬም 2026 22:00 (አዲስ አበባ)'}]});
  });
});
