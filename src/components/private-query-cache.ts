'use client';
import {QueryClient} from '@tanstack/react-query';
import {miniNavigationState} from './mini-navigation-state';
import {matchesPrivateResource,miniQueryPolicy} from './mini-query-policy';
import {chapaConfirmed,type ChapaCheckoutView} from '@/lib/chapa-client';

export type CacheEvent={identity:string|null;kind:'session'|'stored'|'mutation'|'authorization';keys?:readonly string[]};
type ReadValue<T>={value:T;fresh:boolean;updatedAt:number};

export class ObsoletePrivateQueryError extends Error {
  constructor(){super('This private response belongs to an earlier session.');this.name='ObsoletePrivateQueryError'}
}
export class PrivateAuthorizationError extends Error {
  constructor(message:string,readonly status:401|403){super(message);this.name='PrivateAuthorizationError'}
}

/** Display snapshots only, bounded to this tab and authenticated session. No browser storage. */
export class SessionPrivateQueryCache {
  private identity:string|null=null;
  private generation=0;
  private ownedClient:QueryClient|null=null;
  private versions=new Map<string,number>();
  // Payloads and in-flight deduplication belong to TanStack. This map stores
  // only access order so the existing per-session memory bound is preserved.
  private accessed=new Map<string,true>();
  private listeners=new Set<(event:CacheEvent)=>void>();
  constructor(private readonly maxEntries=48,private readonly freshnessMs=30_000,private readonly maxPending=24,private readonly retentionMs=600_000){
  }
  private get client(){
    if(!this.ownedClient){
      this.ownedClient=new QueryClient({defaultOptions:{queries:{retry:false,networkMode:'always',staleTime:this.freshnessMs,gcTime:this.retentionMs},mutations:{retry:false}}});
      this.ownedClient.getQueryCache().subscribe(event=>{if(event.type==='removed'&&event.query.queryKey[0]==='lowin-private'){const key=this.source(event.query.queryKey);this.accessed.delete(key);this.versions.delete(key)}});
    }
    return this.ownedClient;
  }
  get queryClient(){return this.client}
  private key(identity:string,key:string){const [url,language='']=key.split('#language='),at=url.indexOf('?');return ['lowin-private',identity,at<0?url:url.slice(0,at),at<0?'':url.slice(at+1),language] as const}
  private source(key:readonly unknown[]){return String(key[2])+(key[3]?'?'+key[3]:'')+(key[4]?'#language='+key[4]:'')}
  private emit(kind:CacheEvent['kind'],keys?:readonly string[]){const event={identity:this.identity,kind,keys};this.listeners.forEach(listener=>listener(event))}
  private drop(){this.generation++;void this.client.cancelQueries({queryKey:['lowin-private']});this.client.removeQueries({queryKey:['lowin-private']});this.accessed.clear();this.versions.clear()}
  private touch(identity:string,key:string){
    this.accessed.delete(key);this.accessed.set(key,true);
    while(this.accessed.size>this.maxEntries){
      const oldest=this.accessed.keys().next().value!;
      this.client.removeQueries({queryKey:this.key(identity,oldest),exact:true});this.accessed.delete(oldest);
    }
  }
  setIdentity(identity:string|null){
    if(identity===this.identity)return;
    this.identity=identity;this.drop();this.emit('session');
  }
  seed<T>(identity:string,key:string,value:T,updatedAt=Date.now(),retentionMs=this.retentionMs){
    if(!identity||identity!==this.identity)throw new ObsoletePrivateQueryError();
    const queryKey=this.key(identity,key),saved=this.client.getQueryState(queryKey);
    if(saved&&saved.dataUpdatedAt>updatedAt)return;
    if(saved?.fetchStatus==='fetching'){this.versions.set(key,(this.versions.get(key)??0)+1);void this.client.cancelQueries({queryKey,exact:true})}
    this.client.getQueryCache().build(this.client,{queryKey,gcTime:retentionMs});
    this.client.setQueryData(queryKey,value,{updatedAt});this.touch(identity,key);this.emit('stored',[key]);
  }
  read<T>(identity:string,key:string,freshnessMs=this.freshnessMs,retentionMs=this.retentionMs):ReadValue<T>|null{
    if(!identity||identity!==this.identity)return null;
    const queryKey=this.key(identity,key),entry=this.client.getQueryState<T>(queryKey);
    if(!entry||entry.data===undefined)return null;
    const age=Date.now()-entry.dataUpdatedAt;
    if(age>=retentionMs){this.client.removeQueries({queryKey,exact:true});return null}
    this.touch(identity,key);
    return {value:entry.data,fresh:!entry.isInvalidated&&age<freshnessMs,updatedAt:entry.dataUpdatedAt};
  }
  async load<T>(identity:string,key:string,loader:(signal:AbortSignal)=>Promise<T>,{force=false,freshnessMs=this.freshnessMs,retentionMs=this.retentionMs}:{force?:boolean;freshnessMs?:number;retentionMs?:number}={}):Promise<T>{
    if(!identity||identity!==this.identity)throw new ObsoletePrivateQueryError();
    const cached=this.read<T>(identity,key,freshnessMs,retentionMs);
    if(!force&&cached?.fresh)return cached.value;
    const queryKey=this.key(identity,key),active=this.client.getQueryState(queryKey)?.fetchStatus==='fetching';
    if(!active&&this.client.isFetching()>=this.maxPending)throw new Error('Too many requests are already in progress. Please retry.');
    const generation=this.generation,version=this.versions.get(key)??0;
    const current=()=>generation===this.generation&&version===(this.versions.get(key)??0)&&identity===this.identity;
    if(force&&!active)void this.client.invalidateQueries({queryKey,exact:true,refetchType:'none'});
    try{
      const value=await this.client.fetchQuery<T>({queryKey,staleTime:freshnessMs,gcTime:retentionMs,queryFn:async({signal})=>{
        const value=await loader(signal);
        if(!current())throw new ObsoletePrivateQueryError();
        return value;
      }});
      if(!current())throw new ObsoletePrivateQueryError();
      this.touch(identity,key);this.emit('stored',[key]);
      return value;
    }catch(cause){
      // Even an old 401 must not revoke a newer session.
      if(!current())throw new ObsoletePrivateQueryError();
      if(cause instanceof PrivateAuthorizationError)this.authorizationFailure(identity);
      throw cause;
    }
  }
  invalidate(identity:string,scopes?:readonly string[]){
    if(!identity||identity!==this.identity)return;
    const keys=this.client.getQueryCache().findAll({queryKey:['lowin-private',identity]}).filter(query=>query.queryKey.length===5).map(query=>this.source(query.queryKey)).filter(key=>!scopes||scopes.some(scope=>matchesPrivateResource(key,scope)));
    for(const key of keys)this.versions.set(key,(this.versions.get(key)??0)+1);
    // Cancel old reads before a post-mutation refresh, retaining their last
    // committed display snapshot. No mutation/charge is retried by this cache.
    for(const key of keys){const queryKey=this.key(identity,key);void this.client.cancelQueries({queryKey,exact:true});void this.client.invalidateQueries({queryKey,exact:true,refetchType:'none'})}
    this.emit('mutation',scopes);
  }
  authorizationFailure(identity:string){
    if(!identity||identity!==this.identity)return;
    this.drop();this.emit('authorization');
    this.setIdentity(null);
  }
  subscribe(listener:(event:CacheEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  isCurrent(identity:string|null){return !!identity&&identity===this.identity}
  get size(){return this.accessed.size}
}

const cache=new SessionPrivateQueryCache();
/** Server render clients are request-scoped; browser readers share this tab's client. */
export function getMiniQueryClient(){return typeof window==='undefined'?new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}):cache.queryClient}
const intentPending=new Set<string>(),intentAt=new Map<string,number>();
const readers=new Map<string,{count:number;cancel:boolean}>();
cache.subscribe(event=>{
 if(event.kind==='session'||event.kind==='authorization'){miniNavigationState.setIdentity(event.kind==='authorization'?null:event.identity);intentPending.clear();intentAt.clear();readers.clear()}
 if(event.kind==='mutation')intentAt.clear();
});
export function privateQueryKey(url:string,language?:string){
  const parsed=new URL(url,'http://lowwin.invalid');
  parsed.searchParams.sort();
  return parsed.pathname+parsed.search+(language?'#language='+language:'');
}
export function privateQueryFreshness(url:string){
  return miniQueryPolicy(url).staleMs;
}
export function setPrivateQueryIdentity(identity:string|null){cache.setIdentity(identity)}
export function isPrivateQueryIdentity(identity:string|null){return cache.isCurrent(identity)}
export function seedPrivateQuery<T>(identity:string,url:string,value:T,updatedAt?:number){cache.seed(identity,privateQueryKey(url),value,updatedAt,miniQueryPolicy(url).retainMs)}
export function readPrivateQuery<T>(identity:string,url:string,options:{language?:string;freshnessMs?:number}={}){return cache.read<T>(identity,privateQueryKey(url,options.language),options.freshnessMs??privateQueryFreshness(url),miniQueryPolicy(url).retainMs)}
export function subscribePrivateQueries(listener:(event:CacheEvent)=>void){return cache.subscribe(listener)}
export function invalidatePrivateQueries(identity:string,scopes?:readonly string[]){cache.invalidate(identity,scopes)}
export const WALLET_QUERY_SCOPES=['/api/wallet','/api/me','/api/alerts'] as const;
export const PAYMENT_QUERY_SCOPES=[...WALLET_QUERY_SCOPES,'/api/payments/chapa/checkouts','/api/wallet/top-ups'] as const;
export function confirmedBidQueryScopes(slug?:string){return [...PAYMENT_QUERY_SCOPES,'/api/my-bids','/api/profile','/api/catalog/auctions','/api/referrals',slug?`/api/auctions/${encodeURIComponent(slug)}`:'/api/auctions']}
/** A return page can resolve either payment purpose. The committed order,
 * never the screen or redirect parameters, determines affected resources. */
export function confirmedChapaQueryScopes(order:ChapaCheckoutView){
 if(!chapaConfirmed(order))return null;
 return order.purpose==='BID'?confirmedBidQueryScopes(order.auctionSlug??undefined):[...PAYMENT_QUERY_SCOPES,'/api/profile'];
}
export function cancelPrivateQuery(identity:string,url:string){if(cache.isCurrent(identity))void cache.queryClient.cancelQueries({queryKey:['lowin-private',identity,...privateResourceParts(privateQueryKey(url))],exact:true})}
/** Cancel an unused selected resource without cancelling another mounted reader. */
export function retainPrivateQuery(identity:string,url:string,cancelOnUnused=false){
 const key=JSON.stringify([identity,privateQueryKey(url)]),entry=readers.get(key)??{count:0,cancel:false};entry.count++;entry.cancel||=cancelOnUnused;readers.set(key,entry);
 return()=>{const current=readers.get(key);if(!current)return;if(--current.count<=0){readers.delete(key);if(current.cancel)cancelPrivateQuery(identity,url)}};
}
export function miniReadsBusy(){return cache.queryClient.isFetching()>intentPending.size}
function privateResourceParts(key:string){const [url,language='']=key.split('#language='),at=url.indexOf('?');return [at<0?url:url.slice(0,at),at<0?'':url.slice(at+1),language] as const}

/** Low-priority user-intent reads share the same cache and never issue mutations. */
export async function prefetchPrivateQuery(identity:string|null,url:string):Promise<void>{
 if(!identity)return;
 if(miniReadsBusy())return;
 const key=JSON.stringify([identity,privateQueryKey(url)]),now=Date.now();
 if(readPrivateQuery(identity,url)?.fresh||intentPending.has(key)||intentPending.size>=2||now-(intentAt.get(key)??-Infinity)<5000)return;
 intentAt.delete(key);intentAt.set(key,now);while(intentAt.size>32)intentAt.delete(intentAt.keys().next().value!);
 intentPending.add(key);
 try{await loadPrivateJson(identity,url)}catch{/* The ordinary destination keeps its own retryable state. */}finally{intentPending.delete(key)}
}

export async function loadPrivateJson<T>(identity:string,url:string,{force=false,freshnessMs,language}:{force?:boolean;freshnessMs?:number;language?:string}={}):Promise<T>{
  return cache.load(identity,privateQueryKey(url,language),async signal=>{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)])});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=body&&typeof body.error==='string'?body.error:'Could not load this page.';
      if(response.status===401||response.status===403)throw new PrivateAuthorizationError(message,response.status);
      throw new Error(message);
    }
    return body as T;
  },{force,freshnessMs:freshnessMs??privateQueryFreshness(url),retentionMs:miniQueryPolicy(url).retainMs});
}
