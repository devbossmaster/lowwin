import {describe,expect,it,vi} from 'vitest';
import {privateQueryKey,invalidatePrivateQueries,loadPrivateJson,ObsoletePrivateQueryError,PrivateAuthorizationError,readPrivateQuery,SessionPrivateQueryCache,setPrivateQueryIdentity,getMiniQueryClient,seedPrivateQuery,retainPrivateQuery,PAYMENT_QUERY_SCOPES,confirmedBidQueryScopes,confirmedChapaQueryScopes} from '../src/components/private-query-cache';
import type {ChapaCheckoutView} from '../src/lib/chapa-client';

describe('session private query cache',()=>{
 it('refreshes authoritative bid resources from a return page, preserving other auctions and accounts',()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('owner:session');
  const affected=['/api/wallet','/api/me','/api/my-bids?page=2','/api/payments/chapa/checkouts','/api/wallet/top-ups?page=2','/api/catalog/auctions?view=home','/api/catalog/auctions/paid-auction','/api/auctions/paid-auction/bids','/api/auctions/paid-auction/discount-quote?feeVersion=2','/api/profile','/api/referrals/coupons'];
  const untouched=['/api/auctions/other-auction/bids','/api/results/completed?page=2'];
  for(const key of [...affected,...untouched])cache.seed('owner:session',key,{saved:true});
  const order={purpose:'BID',auctionSlug:'paid-auction',status:'BID_ACCEPTED',fundsPreserved:false,receipt:{bid:{id:'accepted'}}} as ChapaCheckoutView;
  const scopes=confirmedChapaQueryScopes(order)!;cache.invalidate('owner:session',scopes);
  for(const key of affected)expect(cache.read('owner:session',key),key).toMatchObject({value:{saved:true},fresh:false});
  for(const key of untouched)expect(cache.read('owner:session',key)?.fresh,key).toBe(true);
  cache.setIdentity('other:session');cache.seed('other:session','/api/wallet',{available:'7.00'});cache.invalidate('owner:session',scopes);
  expect(cache.read('other:session','/api/wallet')).toMatchObject({value:{available:'7.00'},fresh:true});
 });
 it('never invalidates from a redirect or pending provider state, and refreshes preserved late payments',()=>{
  for(const status of ['PENDING','SUBMITTING','SUCCESS','NEEDS_REVIEW'])expect(confirmedChapaQueryScopes({purpose:'BID',auctionSlug:'paid-auction',status,fundsPreserved:false,receipt:null} as ChapaCheckoutView)).toBeNull();
  expect(confirmedChapaQueryScopes({purpose:'BID',auctionSlug:'paid-auction',status:'NEEDS_REVIEW',fundsPreserved:true,receipt:null} as ChapaCheckoutView)).toEqual(expect.arrayContaining(['/api/my-bids','/api/wallet','/api/auctions/paid-auction','/api/referrals']));
  expect(confirmedChapaQueryScopes({purpose:'TOP_UP',auctionSlug:null,status:'CREDITED',fundsPreserved:false,receipt:null} as ChapaCheckoutView)).toEqual(expect.arrayContaining([...PAYMENT_QUERY_SCOPES,'/api/profile']));
 });
 it('reconciles confirmed payments across history and balances while retaining the last authoritative amounts',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a:session');
  for(const [key,value] of [['/api/wallet',{available:'10.00'}],['/api/payments/chapa/checkouts',{items:[{status:'PENDING'}]}],['/api/wallet/top-ups?page=2',{items:[]}],['/api/profile',{name:'Saved name'}]] as const)cache.seed('a:session',key,value);
  cache.invalidate('a:session',PAYMENT_QUERY_SCOPES);
  expect(cache.read('a:session','/api/wallet')).toMatchObject({value:{available:'10.00'},fresh:false});
  expect(cache.read('a:session','/api/payments/chapa/checkouts')?.fresh).toBe(false);
  expect(cache.read('a:session','/api/wallet/top-ups?page=2')?.fresh).toBe(false);
  expect(cache.read('a:session','/api/profile')?.fresh).toBe(true);
  await cache.load('a:session','/api/wallet',async()=>({available:'15.00'}));
  expect(cache.read('a:session','/api/wallet')).toMatchObject({value:{available:'15.00'},fresh:true});
  expect(confirmedBidQueryScopes('selected-auction')).toEqual(expect.arrayContaining([...PAYMENT_QUERY_SCOPES,'/api/my-bids','/api/catalog/auctions','/api/auctions/selected-auction']));
 });
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
 it('refreshes only confirmed mutation resources while unrelated reads keep running',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a');
  cache.seed('a','/api/wallet',100);cache.seed('a','/api/results/winners?page=1',{items:['settled']});
  let complete!:(value:string)=>void,signal!:AbortSignal;
  const profile=cache.load('a','/api/profile',abort=>{signal=abort;return new Promise<string>(resolve=>{complete=resolve})});
  cache.invalidate('a',['/api/wallet']);expect(signal.aborted).toBe(false);
  expect(cache.read('a','/api/wallet')).toMatchObject({value:100,fresh:false});
  expect(cache.read('a','/api/results/winners?page=1')?.fresh).toBe(true);
  complete('current profile');await expect(profile).resolves.toBe('current profile');
 });
 it('does not let an older in-flight read or older server seed replace a committed snapshot',async()=>{
  const cache=new SessionPrivateQueryCache();cache.setIdentity('a');let complete!:(value:number)=>void;
  const old=cache.load('a','/api/wallet',()=>new Promise<number>(resolve=>{complete=resolve}));
  const obsolete=expect(old).rejects.toBeInstanceOf(ObsoletePrivateQueryError);
  const committedAt=Date.now();cache.seed('a','/api/wallet',70,committedAt);complete(100);await obsolete;
  cache.seed('a','/api/wallet',100,committedAt-1);expect(cache.read('a','/api/wallet')?.value).toBe(70);
 });
 it('shares a browser client, scopes server clients, and cancels only an unused selected read',async()=>{
  expect(getMiniQueryClient()).not.toBe(getMiniQueryClient());
  vi.stubGlobal('window',{});setPrivateQueryIdentity('selected');
  try{
   expect(getMiniQueryClient()).toBe(getMiniQueryClient());
   let complete!:(value:Response)=>void,signal!:AbortSignal;
   vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{signal=options.signal!;return new Promise<Response>(resolve=>{complete=resolve})}));
   const first=retainPrivateQuery('selected','/api/results/42/breakdown?page=1',true),second=retainPrivateQuery('selected','/api/results/42/breakdown?page=1',true);
   const request=loadPrivateJson('selected','/api/results/42/breakdown?page=1'),cancelled=expect(request).rejects.toBeDefined();
   first();expect(signal.aborted).toBe(false);second();expect(signal.aborted).toBe(true);complete(Response.json({items:['late']}));await cancelled;
   expect(readPrivateQuery('selected','/api/results/42/breakdown?page=1')).toBeNull();
   seedPrivateQuery('selected','/api/results/winners?page=1',{items:['confirmed']});
   expect(getMiniQueryClient().getQueryCache().find({queryKey:['lowin-private','selected','/api/results/winners','page=1','']})?.gcTime).toBe(1800000);
  }finally{setPrivateQueryIdentity(null);vi.unstubAllGlobals()}
 });
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
