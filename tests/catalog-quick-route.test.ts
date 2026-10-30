import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({quick:vi.fn(),summary:vi.fn(),list:vi.fn()}));
vi.mock('../src/modules/auctions/catalog',async importOriginal=>({
  ...await importOriginal<typeof import('../src/modules/auctions/catalog')>(),listQuickAuctions:f.quick,getAuctionSummary:f.summary,listAuctions:f.list,
}));
import {GET} from '../src/app/api/catalog/auctions/route';
const request=(query:string)=>new Request(`http://localhost/api/catalog/auctions?${query}`);
beforeEach(()=>{f.quick.mockResolvedValue({items:[],total:0,page:1,pageSize:10,totalPages:0,serverNow:'2026-10-26T00:00:00.000Z'});f.summary.mockResolvedValue({totalLive:2,totalUpcoming:1,serverNow:'2026-10-26T00:00:00.000Z'});f.list.mockResolvedValue({items:[]})});
afterEach(()=>vi.resetAllMocks());
describe('bounded quick-auction catalog route',()=>{
  it.each(['','&status=live'])('defaults to live and preserves ten-item pagination %s',async status=>{
    const response=await GET(request(`view=quick&page=2${status}`));expect(response.status).toBe(200);expect(f.quick).toHaveBeenCalledWith('live',2);expect(response.headers.get('cache-control')).toBe('no-store');expect(f.list).not.toHaveBeenCalled();expect(f.summary).not.toHaveBeenCalled();
  });
  it('routes upcoming independently without loading auction details',async()=>{
    expect((await GET(request('view=quick&status=upcoming'))).status).toBe(200);expect(f.quick).toHaveBeenCalledWith('upcoming',1);expect(f.list).not.toHaveBeenCalled();
  });
  it.each(['all','closing','closed','cancelled','live%2Cupcoming',''])('rejects unsupported quick status %s',async status=>{
    const response=await GET(request(`view=quick&status=${status}`));expect(response.status).toBe(400);expect(response.headers.get('cache-control')).toBe('no-store');expect(f.quick).not.toHaveBeenCalled();expect(f.summary).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();
  });
  it.each(['0','1001','abc'])('rejects invalid quick page %s',async page=>{
    expect((await GET(request(`view=quick&page=${page}`))).status).toBe(400);expect(f.quick).not.toHaveBeenCalled();
  });
  it('loads only the tiny aggregate for summary',async()=>{
    const response=await GET(request('view=summary'));expect(await response.json()).toEqual({totalLive:2,totalUpcoming:1,serverNow:'2026-10-26T00:00:00.000Z'});expect(f.summary).toHaveBeenCalledTimes(1);expect(f.quick).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('uses featured Home defaults while preserving explicit sorts and browse code ordering',async()=>{
    await GET(request('view=home&status=closed&page=3'));expect(f.list).toHaveBeenLastCalledWith({q:'',status:'live',sort:'featured',page:3},undefined,10);
    await GET(request('view=home&status=live&sort=ending&category=phones&page=2'));expect(f.list).toHaveBeenLastCalledWith({q:'',status:'live',sort:'ending',category:'phones',page:2},undefined,10);
    await GET(request('view=home&sort=code'));expect(f.list).toHaveBeenLastCalledWith({q:'',status:'live',sort:'code',page:1},undefined,10);
    await GET(request('status=upcoming'));expect(f.list).toHaveBeenLastCalledWith({q:'',status:'upcoming',sort:'code',page:1});expect(f.quick).not.toHaveBeenCalled();expect(f.summary).not.toHaveBeenCalled();
  });
  it.each(['quick','summary'])('returns a retryable no-store error for a failed %s read',async view=>{
    f.quick.mockRejectedValue(new Error('private fixture database failure'));f.summary.mockRejectedValue(new Error('private fixture database failure'));
    const response=await GET(request(`view=${view}`));expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('retry-after')).toBe('5');expect(JSON.stringify(await response.json())).not.toContain('private fixture');
  });
});
