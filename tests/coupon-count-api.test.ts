import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({auth:vi.fn(),count:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/private-api',async()=>{const actual=await vi.importActual<typeof import('../src/modules/auth/private-api')>('../src/modules/auth/private-api');return {...actual,requireUser:f.auth}});
vi.mock('../src/modules/referrals/coupon-count',()=>({getOwnCouponCount:f.count}));
import {GET} from '../src/app/api/referrals/coupon-count/route';
import {PrivateApiError} from '../src/modules/auth/private-api';
beforeEach(()=>{vi.clearAllMocks();f.auth.mockResolvedValue('signed-in-owner');f.count.mockResolvedValue({configured:true,available:4})});
describe('private coupon count route',()=>{
 it('uses the authenticated owner and private caching even when a foreign ID is supplied',async()=>{const response=await GET(new Request('https://lowwin.test/api/referrals/coupon-count?userId=foreign'));expect(await response.json()).toEqual({configured:true,available:4});expect(f.count).toHaveBeenCalledWith({},'signed-in-owner');expect(response.headers.get('cache-control')).toContain('private');expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie')});
 it('requires authentication before reading any reward data',async()=>{f.auth.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));expect((await GET(new Request('https://lowwin.test/api/referrals/coupon-count'))).status).toBe(401);expect(f.count).not.toHaveBeenCalled()});
 it('does not expose a raw database failure',async()=>{f.count.mockRejectedValue(new Error('sensitive internal detail'));const response=await GET(new Request('https://lowwin.test/api/referrals/coupon-count'));expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('sensitive internal detail')});
});
