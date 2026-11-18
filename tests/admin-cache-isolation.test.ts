import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {QueryObserver,useQueryClient,type QueryClient} from '@tanstack/react-query';
import {AdminQueryProvider,adminRequest,clearAdminCache,prefetchAdminResource} from '../src/components/admin-query';
const mount=(identity:string)=>renderToString(createElement(AdminQueryProvider,{identity,children:null}));
function mountClient(identity:string){
 let client!:QueryClient;
 function Capture(){client=useQueryClient();return null}
 renderToString(createElement(AdminQueryProvider,{identity,children:createElement(Capture)}));
 return client;
}
describe('admin late-response isolation',()=>{
 const replace=vi.fn();
 beforeEach(()=>{replace.mockClear();vi.stubGlobal('window',{location:{replace}})});
 afterEach(()=>{clearAdminCache();vi.unstubAllGlobals()});
 it('rejects old mutation receipts after account or permission identity changes',async()=>{let release!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>release=resolve)));mount('first-session');const request=adminRequest('command',{action:'suspend',input:{userId:'player',suspended:true}});mount('new-session');release(Response.json({userId:'player',suspended:true}));await expect(request).rejects.toThrow('session changed');expect(replace).not.toHaveBeenCalled()});
 it.each(['old-session','new-session'])('rejects a forbidden response from an old provider when the current provider has identity %s',async identity=>{let release!:(response:Response)=>void;const fetch=vi.fn(()=>new Promise<Response>(resolve=>release=resolve));vi.stubGlobal('fetch',fetch);mount('old-session');const old=adminRequest('command',{action:'suspend'});mount(identity);release(Response.json({error:'Forbidden'},{status:403}));await expect(old).rejects.toThrow('session changed');expect(replace).not.toHaveBeenCalled();fetch.mockImplementation(async()=>Response.json({items:[{id:'new-private-row'}]}));expect(await adminRequest('workspace/players')).toEqual({items:[{id:'new-private-row'}]})});
 it('clears current private data on a real permission rejection',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Forbidden'},{status:403})));mount('current');await expect(adminRequest('workspace/players')).rejects.toThrow();expect(replace).toHaveBeenCalledWith('/admin');await expect(adminRequest('workspace/players')).rejects.toThrow('not initialized')});
 it('discards a pre-mutation snapshot even when its prefetched resource is still inactive',async()=>{
  const client=mountClient('current'),path='auctions/auction-id',queryKey=['admin','current',path];
  let delayed!:(response:Response)=>void;
  let staleSignal:AbortSignal|null|undefined;
  const fetch=vi.fn((url:string,options:RequestInit)=>{
   if(options.method==='POST')return Promise.resolve(Response.json({auctionId:'auction-id',controlVersion:2,endsAt:'2030-01-02T12:00:00.000Z'}));
   if(!delayed){staleSignal=options.signal;return new Promise<Response>(resolve=>delayed=resolve)}
   return Promise.resolve(Response.json({id:'auction-id',controlVersion:2,endsAt:'2030-01-02T12:00:00.000Z'}));
  });
  vi.stubGlobal('fetch',fetch);
  const warmed=prefetchAdminResource(path);
  await adminRequest('command',{action:'deadline',input:{auctionId:'auction-id',version:1}});
  expect(staleSignal?.aborted).toBe(true);
  delayed(Response.json({id:'auction-id',controlVersion:1,endsAt:'2030-01-01T12:00:00.000Z'}));
  await warmed;
  expect(client.getQueryData(queryKey)).toBeUndefined();
  expect(await adminRequest(path)).toMatchObject({controlVersion:2});
  expect(fetch.mock.calls.filter(([url])=>url.endsWith(path))).toHaveLength(2);
 });
 it('shows the confirmed version and deadline while the one affected refresh is still in progress',async()=>{
  const client=mountClient('current'),queryKey=['admin','current','auctions/auction-id'];
  const previous={id:'auction-id',controlVersion:1,endsAt:'2030-01-01T12:00:00.000Z'},next={...previous,controlVersion:2,endsAt:'2030-01-02T12:00:00.000Z'};
  client.setQueryData(queryKey,previous);
  let release!:(data:typeof next)=>void;
  const refresh=vi.fn(()=>new Promise<typeof next>(resolve=>release=resolve));
  const observer=new QueryObserver(client,{queryKey,queryFn:refresh});
  const unsubscribe=observer.subscribe(()=>{});
  try{
   vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...next,auctionId:next.id})));
   await adminRequest('command',{action:'deadline',input:{auctionId:previous.id,version:1}});
   expect(client.getQueryData(queryKey)).toMatchObject(next);
   expect(refresh).toHaveBeenCalledOnce();
   release(next);
   await vi.waitFor(()=>expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'));
   vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...previous,auctionId:previous.id})));
   await adminRequest('command',{action:'deadline',input:{auctionId:previous.id,version:0}});
   expect(client.getQueryData(queryKey)).toMatchObject(next);
   release(next);
  }finally{unsubscribe()}
 });
});
