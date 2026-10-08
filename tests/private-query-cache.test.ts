import {describe,expect,it,vi} from 'vitest';
import {invalidatePrivateQueries,loadPrivateJson,ObsoletePrivateQueryError,PrivateAuthorizationError,readPrivateQuery,SessionPrivateQueryCache,setPrivateQueryIdentity} from '../src/components/private-query-cache';

describe('session private query cache',()=>{
 it('bounds entries and updates least-recently-used order on reads',async()=>{
  const cache=new SessionPrivateQueryCache(2,1000,4);cache.setIdentity('account-a');
  await cache.load('account-a','one',async()=>1);
  await cache.load('account-a','two',async()=>2);
  expect(cache.read('account-a','one')?.value).toBe(1);
  await cache.load('account-a','three',async()=>3);
  expect(cache.size).toBe(2);
  expect(cache.read('account-a','two')).toBeNull();
  expect(cache.read('account-a','one')?.value).toBe(1);
 });

 it('deduplicates requests and returns fresh data until invalidated',async()=>{
  const cache=new SessionPrivateQueryCache(4,1000,4);cache.setIdentity('account-a');
  let finish!:(value:{balance:string})=>void;const loader=vi.fn(()=>new Promise<{balance:string}>(resolve=>{finish=resolve}));
  const first=cache.load('account-a','wallet',loader),second=cache.load('account-a','wallet',loader);
  expect(loader).toHaveBeenCalledTimes(1);finish({balance:'10.00'});
  await expect(Promise.all([first,second])).resolves.toEqual([{balance:'10.00'},{balance:'10.00'}]);
  await expect(cache.load('account-a','wallet',vi.fn(async()=>({balance:'changed'})))).resolves.toEqual({balance:'10.00'});
  cache.invalidate('account-a');
  await expect(cache.load('account-a','wallet',async()=>({balance:'11.00'}))).resolves.toEqual({balance:'11.00'});
 });

 it('does not restore an obsolete response after identity or authorization changes',async()=>{
  const cache=new SessionPrivateQueryCache(4,1000,4);cache.setIdentity('account-a');
  let resolve!:(value:string)=>void;const request=cache.load('account-a','private',()=>new Promise<string>(done=>{resolve=done}));
  cache.setIdentity('account-b');resolve('private-a');
  await expect(request).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  expect(cache.read('account-b','private')).toBeNull();
  await cache.load('account-b','private',async()=> 'private-b');
  cache.authorizationFailure('account-b');
  expect(cache.read('account-b','private')).toBeNull();
 });

 it('exposes staleness without dropping cached data',async()=>{
  vi.useFakeTimers();
  try{
   const cache=new SessionPrivateQueryCache(4,10,4);cache.setIdentity('account-a');
   await cache.load('account-a','profile',async()=>({name:'Bura'}));
   expect(cache.read('account-a','profile')?.fresh).toBe(true);
   vi.advanceTimersByTime(11);
   expect(cache.read('account-a','profile')?.fresh).toBe(false);
   expect(cache.read('account-a','profile')?.value).toEqual({name:'Bura'});
  }finally{vi.useRealTimers()}
 });

 it('keeps private fetches no-store and reuses a fresh result without another request',async()=>{
  setPrivateQueryIdentity('http-account');
  const request=vi.fn(async()=>Response.json({available:'42.00'}));
  vi.stubGlobal('fetch',request);
  try{
   await expect(loadPrivateJson('http-account','/api/wallet?page=1')).resolves.toEqual({available:'42.00'});
   await expect(loadPrivateJson('http-account','/api/wallet?page=1')).resolves.toEqual({available:'42.00'});
   expect(request).toHaveBeenCalledTimes(1);
   expect(request).toHaveBeenCalledWith('/api/wallet?page=1',expect.objectContaining({cache:'no-store'}));
  }finally{vi.unstubAllGlobals();setPrivateQueryIdentity(null)}
 });

 it('clears private results and rejects late responses after an authorization failure',async()=>{
  setPrivateQueryIdentity('http-account');
  const seed=vi.fn(async()=>Response.json({name:'private'}));
  vi.stubGlobal('fetch',seed);
  await loadPrivateJson('http-account','/api/profile');
  let finishLate!:(response:Response)=>void;
  const request=vi.fn((url:string|URL|Request)=>url.toString().endsWith('/late')?new Promise<Response>(resolve=>{finishLate=resolve}):Promise.resolve(Response.json({error:'Sign in again.'},{status:401})));
  vi.stubGlobal('fetch',request);
  try{
   const late=loadPrivateJson('http-account','/api/private/late');
   await expect(loadPrivateJson('http-account','/api/private/unauthorized')).rejects.toBeInstanceOf(PrivateAuthorizationError);
   finishLate(Response.json({name:'stale session'}));
   await expect(late).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
   expect(readPrivateQuery('http-account','/api/profile')).toBeNull();
   expect(readPrivateQuery('http-account','/api/private/late')).toBeNull();
  }finally{vi.unstubAllGlobals();invalidatePrivateQueries('http-account');setPrivateQueryIdentity(null)}
 });
});
