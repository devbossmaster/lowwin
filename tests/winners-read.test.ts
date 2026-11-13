import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({user:vi.fn(),list:vi.fn(),staging:vi.fn(),db:{fixture:'winners-route'}}));
vi.mock('../src/lib/db',()=>({db:f.db}));
vi.mock('../src/modules/auctions/results',()=>({listCompletedWinners:f.list}));
vi.mock('../src/modules/auctions/staging-demo',()=>({stagingDemoEnabled:f.staging}));
vi.mock('../src/modules/auth/private-api',async original=>({...await original<typeof import('../src/modules/auth/private-api')>(),requireUser:f.user}));
import {GET} from '../src/app/api/results/winners/route';
import {PrivateApiError} from '../src/modules/auth/private-api';
import {getMiniQueryClient,setPrivateQueryIdentity} from '../src/components/private-query-cache';
import {loadPublicJson,prefetchPublicQuery,publicQueryKey,readPublicQuery} from '../src/components/public-query-cache';

const data={items:[],total:0,page:1,totalPages:0,serverNow:'2026-10-25T12:00:00.000Z'};
const request=(query='')=>new Request('https://lowwin.example/api/results/winners'+query);
beforeEach(()=>{vi.clearAllMocks();f.user.mockResolvedValue('verified-player');f.staging.mockReturnValue(false);f.list.mockResolvedValue(data)});
afterEach(()=>{setPrivateQueryIdentity(null);vi.unstubAllGlobals()});
describe('registered finalized Winners read',()=>{
 it('uses the existing finalized-only service with fixed12-record pages and private headers',async()=>{
  const response=await GET(request('?page=2'));expect(response.status).toBe(200);expect(f.list).toHaveBeenCalledWith(f.db,2,12);expect(await response.json()).toEqual({...data,allowDemo:false});expect(response.headers.get('cache-control')).toContain('private, no-store');expect(response.headers.get('vary')).toBe('Cookie');
 });
 it('rejects guests and fails closed during account authentication outages',async()=>{
  f.user.mockRejectedValue(new PrivateApiError(401,'Sign in through Telegram.'));expect((await GET(request())).status).toBe(401);expect(f.list).not.toHaveBeenCalled();
  f.user.mockRejectedValue(Error('Account bootstrap is unavailable'));expect((await GET(request())).status).toBe(503);expect(f.list).not.toHaveBeenCalled();
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
  vi.stubGlobal('window',{});setPrivateQueryIdentity('a:session');const client=getMiniQueryClient();client.clear();let finish!:(response:Response)=>void;const http=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',http);
  const url='/api/results/recent-winners',read=()=>client.fetchQuery({queryKey:publicQueryKey(url),queryFn:({signal})=>loadPublicJson(url,{signal}),staleTime:45000});
  const intent=prefetchPublicQuery(url),open=read();expect(http).toHaveBeenCalledTimes(1);finish(Response.json({...data,allowDemo:false}));await Promise.all([intent,open]);await read();expect(http).toHaveBeenCalledTimes(1);
  await client.invalidateQueries({queryKey:publicQueryKey(url)});const next=read();expect(http).toHaveBeenCalledTimes(2);finish(Response.json({...data,total:1,allowDemo:false}));await next;expect(readPublicQuery<{total:number}>(url)?.value.total).toBe(1);
  setPrivateQueryIdentity('b:session');expect(readPublicQuery<{total:number}>(url)?.value.total).toBe(1);client.clear();
 });
});
