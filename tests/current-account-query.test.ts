import {QueryClient} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CURRENT_ACCOUNT_QUERY_KEY} from '../src/lib/current-account';
import {clearCurrentAccount,loadCurrentAccount} from '../src/components/current-account-query';

const account=(id:string)=>({sessionKey:`session-${id}`,user:{id,name:id,image:null}});
const client=()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
afterEach(()=>vi.unstubAllGlobals());

describe('one current-account query',()=>{
 it('shares pending work and reuses fresh data during normal navigation',async()=>{
  const me=account('A'),transport=vi.fn(async()=>Response.json(me));
  vi.stubGlobal('fetch',transport);
  const query=client();
  await expect(Promise.all([loadCurrentAccount(query),loadCurrentAccount(query),loadCurrentAccount(query)])).resolves.toEqual([me,me,me]);
  await expect(loadCurrentAccount(query)).resolves.toEqual(me);
  expect(transport).toHaveBeenCalledExactlyOnceWith('/api/me',expect.objectContaining({cache:'no-store',credentials:'same-origin'}));
  expect(query.getQueryCache().getAll().map(entry=>entry.queryKey)).toEqual([CURRENT_ACCOUNT_QUERY_KEY]);
  query.clear();
 });
 it('abandons an older pending account read when the authenticated session changes',async()=>{
  let reply!: (body:Response)=>void;
  const transport=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{reply=resolve})).mockResolvedValueOnce(Response.json(account('B')));
  vi.stubGlobal('fetch',transport);
  const query=client(),old=loadCurrentAccount(query).catch(error=>error);
  expect(transport).toHaveBeenCalledOnce();
  clearCurrentAccount(query);
  expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
  await expect(loadCurrentAccount(query)).resolves.toEqual(account('B'));
  reply(Response.json(account('A')));
  expect(await old).toBeInstanceOf(Error);
  expect(query.getQueryData(CURRENT_ACCOUNT_QUERY_KEY)).toEqual(account('B'));
  clearCurrentAccount(query);
  expect(query.getQueryState(CURRENT_ACCOUNT_QUERY_KEY)).toBeUndefined();
 });
 it('joins explicit refreshes and distinguishes session expiry from an outage',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(Response.json(account('A'))).mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(new Response(null,{status:401}));
  vi.stubGlobal('fetch',transport);
  const query=client();
  await loadCurrentAccount(query);
  const errors=await Promise.allSettled([loadCurrentAccount(query,true),loadCurrentAccount(query,true)]);
  expect(errors.map(result=>result.status)).toEqual(['rejected','rejected']);
  expect(query.getQueryData(CURRENT_ACCOUNT_QUERY_KEY)).toEqual(account('A'));
  await expect(loadCurrentAccount(query,true)).resolves.toBeNull();
  expect(transport).toHaveBeenCalledTimes(3);
  query.clear();
 });
});
