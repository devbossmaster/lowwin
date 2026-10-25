import {afterEach,describe,expect,it,vi} from 'vitest';
import {SessionNavigationState,miniNavigationState,miniRouteKey} from '../src/components/mini-navigation-state';
import {IntentPrefetchBudget,privateIntentDestination,prefetchMiniIntent,prefetchAuctionIntent} from '../src/components/mini-prefetch';
import {invalidatePrivateQueries,loadPrivateJson,prefetchPrivateQuery,readPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';

afterEach(()=>{setPrivateQueryIdentity(null);vi.unstubAllGlobals();vi.useRealTimers()});
describe('session-local navigation coordinates',()=>{
 it('matches encoded filter URLs while preserving their original destination spelling',()=>{
  const memory=new SessionNavigationState();memory.setIdentity('a');memory.remember('a','/?q=QA%20client%20flow&sort=fee-low',3202);
  const saved=memory.visit('a','/');expect(saved?.href).toBe('/?q=QA%20client%20flow&sort=fee-low');
  expect(miniRouteKey(saved!.href)).toBe(miniRouteKey('/?sort=fee-low&q=QA+client+flow'));
  expect(miniRouteKey('/?q=a%2Bb')).not.toBe(miniRouteKey('/?q=a+b'));
 });
 it('retains exact filters, pagination and scroll without carrying response payloads',()=>{
  const memory=new SessionNavigationState();memory.setIdentity('user:session');
  memory.remember('user:session','/?category=phones&sort=fee-low&q=case',3240);
  memory.rememberPage('user:session','/?category=phones&sort=fee-low&q=case',3);
  memory.remember('user:session','/my-bids?view=history&page=2',480);
  expect(memory.visit('user:session','/')).toMatchObject({href:'/?category=phones&sort=fee-low&q=case',scrollY:3240});
  expect(memory.page('user:session','/?category=phones&sort=fee-low&q=case')).toBe(3);
  expect(memory.page('user:session','/?category=other')).toBe(1);
  expect(memory.visit('user:session','/my-bids')).toMatchObject({href:'/my-bids?view=history&page=2',scrollY:480});
 });
 it('does not mix accounts or revive an earlier session of the same account',()=>{
  const memory=new SessionNavigationState();memory.setIdentity('a:old');memory.remember('a:old','/?q=private-search',600);memory.rememberPage('a:old','feed',4);
  memory.setIdentity('b');expect(memory.visit('b','/')).toBeNull();expect(memory.page('b','feed')).toBe(1);
  memory.remember('a:old','/?q=late-old-search',800);memory.setIdentity('a:new');expect(memory.visit('a:new','/')).toBeNull();
 });
 it('expires coordinates, bounds list keys and rejects external or malformed destinations',()=>{
  vi.useFakeTimers();const memory=new SessionNavigationState(100,2);memory.setIdentity('a');
  for(const [key,page] of [['one',2],['two',3],['three',4]] as const)memory.rememberPage('a',key,page);
  expect(memory.page('a','one')).toBe(1);expect(memory.page('a','three')).toBe(4);
  memory.remember('a','https://outside.example/?q=x',10);expect(memory.visit('a','/')).toBeNull();
  memory.remember('a','/?q=current',10);vi.advanceTimersByTime(101);expect(memory.visit('a','/')).toBeNull();expect(memory.page('a','three')).toBe(1);
 });
 it('clears view state through the same identity boundary as private data',()=>{
  setPrivateQueryIdentity('a');miniNavigationState.remember('a','/?q=private',500);miniNavigationState.rememberPage('a','feed',2);
  setPrivateQueryIdentity(null);setPrivateQueryIdentity('a');expect(miniNavigationState.visit('a','/')).toBeNull();expect(miniNavigationState.page('a','feed')).toBe(1);
 });
});
describe('bounded user-intent warming',()=>{
 it('deduplicates route intent, caps rapid unique destinations, then allows later intent',()=>{
  const budget=new IntentPrefetchBudget();expect(budget.allow('a','/',1000)).toBe(true);expect(budget.allow('a','/',1700)).toBe(false);
  for(const target of ['/winners','/my-bids','/profile'])expect(budget.allow('a',target,2000)).toBe(true);
  expect(budget.allow('a','/auctions/other',2500)).toBe(false);expect(budget.allow('a','/auctions/other',11000)).toBe(true);expect(budget.allow('a','/',32000)).toBe(true);
  budget.reset();expect(budget.allow('b','/',32001)).toBe(true);
 });
 it('warms only the requested personal page, never every result or participant list',()=>{
  expect(privateIntentDestination('/my-bids')).toBe('/api/my-bids?view=all&page=1');
  expect(privateIntentDestination('/my-bids?view=history&page=2')).toBe('/api/my-bids?view=history&page=2');
  expect(privateIntentDestination('/profile')).toBe('/api/profile');
  expect(privateIntentDestination('/winners')).toBe('/api/results/winners?page=1');expect(privateIntentDestination('/winners?page=3')).toBe('/api/results/winners?page=3');expect(privateIntentDestination('/api/results/1/breakdown?amount=50')).toBeNull();
  expect(privateIntentDestination('https://other.example/profile')).toBeNull();
 });
 it('coalesces intent and the actual destination into one private no-store request',async()=>{
  setPrivateQueryIdentity('intent');let finish!:(response:Response)=>void;
  const request=vi.fn((_url:string,_options?:RequestInit)=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',request);
  const warm=prefetchPrivateQuery('intent','/api/profile'),open=loadPrivateJson('intent','/api/profile');expect(request).toHaveBeenCalledTimes(1);
  finish(Response.json({name:'Actual profile'}));await Promise.all([warm,open]);await prefetchPrivateQuery('intent','/api/profile');expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][1]).toMatchObject({cache:'no-store'});
 });
 it('caps speculative concurrent API reads without blocking an explicit destination request',async()=>{
  setPrivateQueryIdentity('a');const finish=new Map<string,(response:Response)=>void>();
  const request=vi.fn((url:string)=>new Promise<Response>(resolve=>finish.set(url,resolve)));vi.stubGlobal('fetch',request);
  const first=prefetchPrivateQuery('a','/api/profile'),second=prefetchPrivateQuery('a','/api/my-bids?view=all&page=1');
  await prefetchPrivateQuery('a','/api/wallet');expect(request).toHaveBeenCalledTimes(2);
  const explicit=loadPrivateJson('a','/api/wallet');expect(request).toHaveBeenCalledTimes(3);
  for(const resolve of finish.values())resolve(Response.json({available:'20'}));await Promise.all([first,second,explicit]);
 });
 it('invalidates a warmed snapshot after a confirmed mutation and aborts warming on account change',async()=>{
  setPrivateQueryIdentity('a');let finish!:(response:Response)=>void;const request=vi.fn(async()=>Response.json({available:'20'}));vi.stubGlobal('fetch',request);
  await prefetchPrivateQuery('a','/api/wallet');invalidatePrivateQueries('a');await prefetchPrivateQuery('a','/api/wallet');expect(request).toHaveBeenCalledTimes(2);
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve})));const pending=prefetchPrivateQuery('a','/api/profile');setPrivateQueryIdentity('b');finish(Response.json({name:'Old account'}));await pending;expect(readPrivateQuery('b','/api/profile')).toBeNull();
 });
 it('skips low-priority navigation warming when Save Data is enabled',()=>{
  vi.stubGlobal('navigator',{connection:{saveData:true}});const router=vi.fn();prefetchMiniIntent(null,'/profile',router);expect(router).not.toHaveBeenCalled();
 });
 it('skips card warming on Save Data and slow connections',()=>{
  setPrivateQueryIdentity('constrained');const request=vi.fn();vi.stubGlobal('fetch',request);
  for(const connection of [{saveData:true},{effectiveType:'2g'},{effectiveType:'slow-2g'}]){
   vi.stubGlobal('navigator',{connection});prefetchAuctionIntent('constrained','phone');
  }
  expect(request).not.toHaveBeenCalled();
 });
 it('bounds sequential card intent as well as concurrent requests',async()=>{
  setPrivateQueryIdentity('card-intent');vi.stubGlobal('navigator',{connection:{effectiveType:'4g'}});
  const request=vi.fn(async(_url:string)=>Response.json({available:'20'}));vi.stubGlobal('fetch',request);
  for(let index=0;index<20;index++){
   prefetchAuctionIntent('card-intent',`phone-${index}`);
   // Let each request finish: the shared intent budget must still bound the total.
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  const urls=request.mock.calls.map(call=>String(call[0]));
  expect(urls.filter(url=>url.includes('/bids'))).toHaveLength(4);
  expect(urls.filter(url=>url==='/api/wallet')).toHaveLength(1);
 });
 it('warms only the chosen quick card details and own entry state in the existing cache',async()=>{
  setPrivateQueryIdentity('quick-card-intent');vi.stubGlobal('navigator',{connection:{effectiveType:'4g'}});
  const request=vi.fn(async(_url:string)=>Response.json({code:'42'}));vi.stubGlobal('fetch',request);
  prefetchAuctionIntent('quick-card-intent','phone-42',{details:true});await new Promise(resolve=>setTimeout(resolve,0));
  prefetchAuctionIntent('quick-card-intent','phone-42',{details:true});await new Promise(resolve=>setTimeout(resolve,0));
  expect(request.mock.calls.map(call=>String(call[0]))).toEqual(['/api/catalog/auctions/phone-42','/api/auctions/phone-42/bids']);
  expect(readPrivateQuery('quick-card-intent','/api/catalog/auctions/phone-42')?.value).toEqual({code:'42'});
 });
});
