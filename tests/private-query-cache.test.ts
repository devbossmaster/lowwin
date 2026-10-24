import {describe,expect,it,vi} from 'vitest';
import {privateQueryKey,invalidatePrivateQueries,loadPrivateJson,ObsoletePrivateQueryError,PrivateAuthorizationError,readPrivateQuery,SessionPrivateQueryCache,setPrivateQueryIdentity} from '../src/components/private-query-cache';

describe('session private query cache',()=>{
 it('seeds the verified bootstrap without another read and rejects another identity',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('account:session');
  cache.seed('account:session','/api/me',{user:{id:'account'}});
  const loader=vi.fn(async()=>({user:{id:'unexpected'}}));
  expect(await cache.load('account:session','/api/me',loader)).toEqual({user:{id:'account'}});expect(loader).not.toHaveBeenCalled();
  cache.setIdentity('other:session');expect(cache.read('other:session','/api/me')).toBeNull();
  expect(()=>cache.seed('account:session','/api/me',{user:{id:'account'}})).toThrow(ObsoletePrivateQueryError);
 });
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

describe('private cache navigation regressions',()=>{
 it('aborts obsolete reads when an account changes, without exposing their payload',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('old');
  let finish!:(value:string)=>void,captured:AbortSignal|undefined;
  const pending=cache.load('old','profile',signal=>{captured=signal;return new Promise<string>(resolve=>{finish=resolve})});
  const rejected=expect(pending).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  cache.setIdentity('new');expect(captured?.aborted).toBe(true);finish('private old account');await rejected;
  expect(cache.read('new','profile')).toBeNull();
 });
 it('does not automatically retry a failed read or pause it waiting for connectivity',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a');
  const loader=vi.fn(async()=>{throw Error('Network unavailable')});
  await expect(cache.load('a','profile',loader)).rejects.toThrow('Network unavailable');
  expect(loader).toHaveBeenCalledTimes(1);
  await cache.load('a','profile',async()=>({name:'Recovered'}));
  expect(cache.read('a','profile')?.value).toEqual({name:'Recovered'});
 });
 it('deduplicates a post-payment refresh across readers and ignores the cancelled old result',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a');
  await cache.load('a','wallet',async()=>100);
  let oldDone!:(value:number)=>void,newDone!:(value:number)=>void;
  const old=cache.load('a','wallet',()=>new Promise<number>(resolve=>{oldDone=resolve}),{force:true});
  const obsolete=expect(old).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  cache.invalidate('a');expect(cache.read('a','wallet')).toMatchObject({value:100,fresh:false});
  const loader=vi.fn(()=>new Promise<number>(resolve=>{newDone=resolve}));
  const next=cache.load('a','wallet',loader),other=cache.load('a','wallet',loader);
  expect(loader).toHaveBeenCalledTimes(1);newDone(70);oldDone(100);await obsolete;await Promise.all([next,other]);
  expect(cache.read('a','wallet')).toMatchObject({value:70,fresh:true});
 });
 it('retains a stale snapshot after mutation but rejects the pre-mutation response',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a:session');
  await cache.load('a:session','wallet',async()=>10);
  let finish!:(value:number)=>void;
  const old=cache.load('a:session','wallet',()=>new Promise<number>(resolve=>{finish=resolve}),{force:true});
  cache.invalidate('a:session');
  expect(cache.read('a:session','wallet')).toMatchObject({value:10,fresh:false});
  await cache.load('a:session','wallet',async()=>9);finish(10);
  await expect(old).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  expect(cache.read('a:session','wallet')).toMatchObject({value:9,fresh:true});
 });
 it('isolates new sessions of the same account and ignores late authorization failures',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a:old');
  let reject!:(reason:Error)=>void;
  const old=cache.load('a:old','profile',()=>new Promise<string>((_,fail)=>{reject=fail}));
  cache.setIdentity('a:new');await cache.load('a:new','profile',async()=>'new session');
  reject(new PrivateAuthorizationError('Expired',401));
  await expect(old).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  expect(cache.read('a:new','profile')?.value).toBe('new session');
  expect(cache.read('a:old','profile')).toBeNull();
 });
 it('expires retained snapshots and bounds concurrent requests',async()=>{
  vi.useFakeTimers();
  try{
   const cache=new SessionPrivateQueryCache(2,10,1,100);cache.setIdentity('a');
   await cache.load('a','profile',async()=>1);vi.advanceTimersByTime(101);
   expect(cache.read('a','profile')).toBeNull();
   let finish!:(value:number)=>void;
   const pending=cache.load('a','first',()=>new Promise<number>(r=>{finish=r}));
   await expect(cache.load('a','second',async()=>2)).rejects.toThrow('Too many requests');
   finish(1);await pending;
  }finally{vi.useRealTimers()}
 });
 it('canonicalizes query ordering without mixing filters, pages or languages',()=>{
  expect(privateQueryKey('/api/favorites?page=2&status=live','am')).toBe(privateQueryKey('/api/favorites?status=live&page=2','am'));
  expect(privateQueryKey('/api/favorites?page=2','am')).not.toBe(privateQueryKey('/api/favorites?page=1','am'));
  expect(privateQueryKey('/api/favorites?page=2','am')).not.toBe(privateQueryKey('/api/favorites?page=2','en'));
 });
});
