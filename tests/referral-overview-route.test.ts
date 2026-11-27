import {beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({session:vi.fn(),overview:vi.fn(),policy:vi.fn(),db:{}}));
vi.mock('@/lib/db',()=>({db:fixture.db}));
vi.mock('@/modules/auth/mini-access',()=>({getMiniSession:fixture.session}));
vi.mock('@/modules/referrals/service',()=>({getReferralOverview:fixture.overview,getReferralPolicy:fixture.policy}));
import {GET} from '@/app/api/referrals/route';

const overview={configured:true,enabled:true,shareUrl:'https://t.me/lowwin_fixture_bot?start=ref_abcdefghijkl',webShareUrl:'https://lowwin.test/?ref=abcdefghijkl',rewardEtb:'12.50',counts:{signedUp:2,qualified:1,earned:1},totalEarnedEtb:'12.50',recentInvites:[]};
const request=(query='')=>new Request(`https://lowwin.test/api/referrals${query}`);

beforeEach(()=>{vi.resetAllMocks();fixture.session.mockResolvedValue({user:{id:'account-owner'}});fixture.overview.mockResolvedValue(overview);fixture.policy.mockResolvedValue({...overview,version:4,updatedAt:'2026-11-27T00:00:00Z'})});

describe('private affiliate reads',()=>{
 it.each(['','?view=policy'])('requires a verified session before reading data%s',async query=>{
  fixture.session.mockResolvedValue(null);
  const response=await GET(request(query));
  expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(fixture.overview).not.toHaveBeenCalled();expect(fixture.policy).not.toHaveBeenCalled();
 });
 it('loads the referral overview for the authenticated owner',async()=>{
  const response=await GET(request('?userId=other-account'));
  expect(await response.json()).toEqual(overview);expect(response.headers.get('vary')).toBe('Cookie');
  expect(fixture.overview).toHaveBeenCalledExactlyOnceWith(fixture.db,'account-owner');expect(fixture.policy).not.toHaveBeenCalled();
 });
 it('returns only the referral policy summary without loading or creating an invite',async()=>{
  const response=await GET(request('?view=policy'));
  expect(await response.json()).toEqual({configured:true,enabled:true,rewardEtb:'12.50'});
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(fixture.policy).toHaveBeenCalledExactlyOnceWith(fixture.db);expect(fixture.overview).not.toHaveBeenCalled();
 });
});
