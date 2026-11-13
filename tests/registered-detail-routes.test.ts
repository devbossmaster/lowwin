import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({authorize:vi.fn(),auction:vi.fn(),result:vi.fn(),list:vi.fn(),breakdown:vi.fn()}));
vi.mock('../src/lib/db',()=>({db:{}}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.authorize}));
vi.mock('../src/modules/auctions/catalog',()=>({getAuction:f.auction}));
vi.mock('../src/modules/auctions/results',()=>({getPublicResult:f.result,listPublicResults:f.list,resultQuerySchema:{safeParse:()=>({success:true,data:{page:1}})}}));
vi.mock('../src/modules/auctions/result-breakdown',()=>({getResultBreakdown:f.breakdown,breakdownQuery:{safeParse:()=>({success:true,data:{page:1}})}}));
import {PrivateApiError} from '../src/modules/auth/private-api';
import {GET as auction} from '../src/app/api/catalog/auctions/[slug]/route';
import {GET as result} from '../src/app/api/results/[auctionCode]/route';
import {GET as results} from '../src/app/api/results/route';
import {GET as breakdown} from '../src/app/api/results/[auctionCode]/breakdown/route';
beforeEach(()=>{vi.clearAllMocks();f.authorize.mockResolvedValue('verified-customer');for(const read of [f.auction,f.result,f.list,f.breakdown])read.mockResolvedValue({marker:'registered-detail'})});
const cases=[['result',()=>result(new Request('https://lowwin.test/api/results/42'),{params:Promise.resolve({auctionCode:'42'})})],['results',()=>results(new Request('https://lowwin.test/api/results'))],['breakdown',()=>breakdown(new Request('https://lowwin.test/api/results/42/breakdown'),{params:Promise.resolve({auctionCode:'42'})})]] as const;
describe('registered-only detailed data handlers',()=>{
 for(const [name,request] of cases){
  it(`denies ${name} before any projection read for a guest/revoked/expired account`,async()=>{f.authorize.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));const response=await request();expect(response.status).toBe(401);expect(await response.text()).not.toContain('registered-detail');for(const read of [f.auction,f.result,f.list,f.breakdown])expect(read).not.toHaveBeenCalled()});
  it(`returns private ${name} data only after server authorization`,async()=>{const response=await request();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');expect(await response.json()).toEqual({marker:'registered-detail'});expect(f.authorize).toHaveBeenCalledTimes(1)});
  it(`fails closed on an authorization outage for ${name}`,async()=>{f.authorize.mockRejectedValue(Error('private database detail'));const response=await request();expect(response.status).toBe(503);expect(await response.text()).not.toContain('private database detail');for(const read of [f.auction,f.result,f.list,f.breakdown])expect(read).not.toHaveBeenCalled()});
 }
});
