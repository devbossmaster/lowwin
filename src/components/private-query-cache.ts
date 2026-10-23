'use client';
import {QueryClient} from '@tanstack/react-query';

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
  private client:QueryClient;
  // Payloads and in-flight deduplication belong to TanStack. This map stores
  // only access order so the existing per-session memory bound is preserved.
  private accessed=new Map<string,true>();
  private listeners=new Set<(event:CacheEvent)=>void>();
  constructor(private readonly maxEntries=48,private readonly freshnessMs=30_000,private readonly maxPending=24,private readonly retentionMs=600_000){
    this.client=new QueryClient({defaultOptions:{queries:{retry:false,networkMode:'always',staleTime:freshnessMs,gcTime:retentionMs},mutations:{retry:false}}});
    this.client.getQueryCache().subscribe(event=>{
      if(event.type==='removed')this.accessed.delete(String(event.query.queryKey[2]));
    });
  }
  private key(identity:string,key:string){return ['lowin-private',identity,key] as const}
  private emit(kind:CacheEvent['kind'],keys?:readonly string[]){const event={identity:this.identity,kind,keys};this.listeners.forEach(listener=>listener(event))}
  private drop(){this.generation++;this.client.clear();this.accessed.clear()}
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
  read<T>(identity:string,key:string,freshnessMs=this.freshnessMs):ReadValue<T>|null{
    if(!identity||identity!==this.identity)return null;
    const queryKey=this.key(identity,key),entry=this.client.getQueryState<T>(queryKey);
    if(!entry||entry.data===undefined)return null;
    const age=Date.now()-entry.dataUpdatedAt;
    if(age>=this.retentionMs){this.client.removeQueries({queryKey,exact:true});return null}
    this.touch(identity,key);
    return {value:entry.data,fresh:!entry.isInvalidated&&age<freshnessMs,updatedAt:entry.dataUpdatedAt};
  }
  async load<T>(identity:string,key:string,loader:(signal:AbortSignal)=>Promise<T>,{force=false,freshnessMs=this.freshnessMs}:{force?:boolean;freshnessMs?:number}={}):Promise<T>{
    if(!identity||identity!==this.identity)throw new ObsoletePrivateQueryError();
    const cached=this.read<T>(identity,key,freshnessMs);
    if(!force&&cached?.fresh)return cached.value;
    const queryKey=this.key(identity,key),active=this.client.getQueryState(queryKey)?.fetchStatus==='fetching';
    if(!active&&this.client.isFetching()>=this.maxPending)throw new Error('Too many requests are already in progress. Please retry.');
    const generation=this.generation;
    const current=()=>generation===this.generation&&identity===this.identity;
    if(force&&!active)void this.client.invalidateQueries({queryKey,exact:true,refetchType:'none'});
    try{
      const value=await this.client.fetchQuery<T>({queryKey,staleTime:freshnessMs,queryFn:async({signal})=>{
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
  invalidate(identity:string){
    if(!identity||identity!==this.identity)return;
    this.generation++;
    // Cancel old reads before a post-mutation refresh, retaining their last
    // committed display snapshot. No mutation/charge is retried by this cache.
    void this.client.cancelQueries({queryKey:['lowin-private',identity]});
    void this.client.invalidateQueries({queryKey:['lowin-private',identity],refetchType:'none'});
    this.emit('mutation');
  }
  authorizationFailure(identity:string){
    if(!identity||identity!==this.identity)return;
    this.drop();this.emit('authorization');
    this.setIdentity(null);
  }
  subscribe(listener:(event:CacheEvent)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  get size(){return this.accessed.size}
}

const cache=new SessionPrivateQueryCache();
export function privateQueryKey(url:string,language?:string){
  const parsed=new URL(url,'http://lowwin.invalid');
  parsed.searchParams.sort();
  return parsed.pathname+parsed.search+(language?'#language='+language:'');
}
export function privateQueryFreshness(url:string){
  const path=url.split('?',1)[0];
  if(path.endsWith('/bids')||path.startsWith('/api/wallet')||path==='/api/me')return 15_000;
  if(url==='/api/profile')return 60_000;
  return 30_000;
}
export function setPrivateQueryIdentity(identity:string|null){cache.setIdentity(identity)}
export function readPrivateQuery<T>(identity:string,url:string,options:{language?:string;freshnessMs?:number}={}){return cache.read<T>(identity,privateQueryKey(url,options.language),options.freshnessMs??privateQueryFreshness(url))}
export function subscribePrivateQueries(listener:(event:CacheEvent)=>void){return cache.subscribe(listener)}
export function invalidatePrivateQueries(identity:string){cache.invalidate(identity)}

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
  },{force,freshnessMs:freshnessMs??privateQueryFreshness(url)});
}
