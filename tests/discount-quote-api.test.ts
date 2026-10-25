import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({user:vi.fn(),quote:vi.fn(),db:{fixture:'quote-read'},ReferralError:class extends Error{constructor(public status:number,public code:string,message:string){super(message)}}}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/referrals/service',()=>({getBidDiscountQuote:f.quote,ReferralError:f.ReferralError}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.user}));
import {PrivateApiError} from '../src/modules/auth/private-api';
import {GET} from '../src/app/api/auctions/[slug]/discount-quote/route';
const quote={eligible:true,feeVersion:2,grossFeePoints:'10',discountPoints:'1',netFeePoints:'9',serverNow:'2026-10-26T10:00:00Z',coupon:{id:'12345678-1234-4234-8234-123456789012',percent:10,expiresAt:'2026-11-10T10:00:00Z'}};
const request=(query='')=>new Request('https://lowwin.example/api/auctions/phone/discount-quote'+query),params={params:Promise.resolve({slug:'phone'})};
beforeEach(()=>{vi.clearAllMocks();f.user.mockResolvedValue('owner');f.quote.mockResolvedValue(quote)});
afterEach(()=>vi.restoreAllMocks());
describe('private earned-discount quote',()=>{
 it('uses authenticated ownership and server fee data, with private no-store headers',async()=>{
  const response=await GET(request('?feeVersion=2'),params);expect(response.status).toBe(200);expect(await response.json()).toEqual(quote);expect(f.quote).toHaveBeenCalledWith(f.db,'owner','phone',undefined);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
 });
 it('requires account proof before any quote read',async()=>{f.user.mockRejectedValue(new PrivateApiError(401,'Sign in.'));expect((await GET(request('?feeVersion=bad'),params)).status).toBe(401);expect(f.quote).not.toHaveBeenCalled()});
 it.each(['?amount=1','?userId=other','?couponId=invalid','?feeVersion=0','?feeVersion=1.5','?feeVersion=2&feeVersion=3'])('rejects client-supplied money, ownership or invalid query: %s',async query=>{expect((await GET(request(query),params)).status).toBe(422);expect(f.quote).not.toHaveBeenCalled()});
 it('refuses to present a discount against a superseded fee quote',async()=>{const response=await GET(request('?feeVersion=1'),params);expect(response.status).toBe(409);expect(response.headers.get('cache-control')).toContain('no-store')});
 it('preserves a safe unavailable-reward response without exposing another account',async()=>{f.quote.mockRejectedValue(new f.ReferralError(409,'COUPON_UNAVAILABLE','This earned discount is unavailable or expired.'));const response=await GET(request(),params);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'COUPON_UNAVAILABLE'})});
 it('does not expose raw storage failures',async()=>{f.quote.mockRejectedValue(Error('private connection details'));const response=await GET(request(),params);expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('private connection');expect(response.headers.get('vary')).toBe('Cookie')});
});
