import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({user:vi.fn(),list:vi.fn(),staging:vi.fn(),db:{fixture:'winners-route'}}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/auctions/results',()=>({listCompletedWinners:f.list}));
vi.mock('../src/modules/auctions/staging-demo',()=>({stagingDemoEnabled:f.staging}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.user}));
import {PrivateApiError} from '../src/modules/auth/private-api';
import {GET} from '../src/app/api/results/winners/route';
import {invalidatePrivateQueries,loadPrivateJson,prefetchPrivateQuery,readPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';

const data={items:[],total:0,page:1,totalPages:0,serverNow:'2026-10-25T12:00:00.000Z'};
const request=(query='')=>new Request('https://lowwin.example/api/results/winners'+query);
beforeEach(()=>{vi.clearAllMocks();f.user.mockResolvedValue('verified-player');f.staging.mockReturnValue(false);f.list.mockResolvedValue(data)});
afterEach(()=>{setPrivateQueryIdentity(null);vi.unstubAllGlobals()});
describe('authenticated finalized Winners read',()=>{
 it('uses the existing finalized-only service with fixed12-record pages and private headers',async()=>{
  const response=await GET(request('?page=2'));expect(response.status).toBe(200);expect(f.list).toHaveBeenCalledWith(f.db,2,12);expect(await response.json()).toEqual({...data,allowDemo:false});expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
 });
 it('requires the verified account before any result read, even with invalid query input',async()=>{
  f.user.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));const response=await GET(request('?page=invalid'));expect(response.status).toBe(401);expect(f.list).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');
 });
 it.each(['?page=0','?page=-1','?page=10001','?page=1.5','?page=bad','?page=1&page=2','?userId=another-player','?pageSize=96','?status=pending'])('rejects unsupported result query %s',async query=>{
  const response=await GET(request(query));expect(response.status).toBe(422);expect(f.list).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toContain('no-store');
 });
 it('uses the existing server staging capability without a browser demo override',async()=>{
  f.staging.mockReturnValue(true);expect(await (await GET(request())).json()).toMatchObject({allowDemo:true});expect((await GET(request('?allowDemo=true'))).status).toBe(422);
 });
 it('keeps failures private and does not expose a raw database error',async()=>{
  f.list.mockRejectedValue(Error('private database connection details'));const response=await GET(request());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('private database');expect(response.headers.get('vary')).toBe('Cookie');
 });
});
describe('Winners cache reuse through the existing query layer',()=>{
 it('coalesces intent with first open, reuses repeat navigation, and refreshes after invalidation',async()=>{
  setPrivateQueryIdentity('a:session');let finish!:(response:Response)=>void;const http=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',http);
  const intent=prefetchPrivateQuery('a:session','/api/results/winners?page=1'),open=loadPrivateJson('a:session','/api/results/winners?page=1');expect(http).toHaveBeenCalledTimes(1);finish(Response.json({...data,allowDemo:false}));await Promise.all([intent,open]);await loadPrivateJson('a:session','/api/results/winners?page=1');expect(http).toHaveBeenCalledTimes(1);
  invalidatePrivateQueries('a:session');const next=loadPrivateJson('a:session','/api/results/winners?page=1');expect(http).toHaveBeenCalledTimes(2);finish(Response.json({...data,total:1,allowDemo:false}));await next;expect(readPrivateQuery<{total:number}>('a:session','/api/results/winners?page=1')?.value.total).toBe(1);
  setPrivateQueryIdentity('b:session');expect(readPrivateQuery('b:session','/api/results/winners?page=1')).toBeNull();
 });
});
