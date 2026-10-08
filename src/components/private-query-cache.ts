'use client';

type CacheEvent={identity:string|null;kind:'session'|'stored'|'mutation'|'authorization'};
type Entry={identity:string;value:unknown;updatedAt:number};
type Pending={generation:number;promise:Promise<unknown>};
type ReadValue<T>={value:T;fresh:boolean;updatedAt:number};

export class ObsoletePrivateQueryError extends Error {
  constructor(){super('This private response belongs to an earlier session.');this.name='ObsoletePrivateQueryError'}
}
export class PrivateAuthorizationError extends Error {
  constructor(message:string,readonly status:401|403){super(message);this.name='PrivateAuthorizationError'}
}

/** A small, per-session cache for private display data. It never writes to storage. */
export class SessionPrivateQueryCache {
  private identity:string|null=null;
  private generation=0;
  private entries=new Map<string,Entry>();
  private pending=new Map<string,Pending>();
  private listeners=new Set<(event:CacheEvent)=>void>();
  constructor(private readonly maxEntries=48,private readonly freshnessMs=12_000,private readonly maxPending=24){}
  private emit(kind:CacheEvent['kind']){const event={identity:this.identity,kind};this.listeners.forEach(listener=>listener(event))}
  private drop(){this.generation++;this.entries.clear();this.pending.clear()}
  setIdentity(identity:string|null){
    if(identity===this.identity)return;
    this.identity=identity;this.drop();this.emit('session');
  }
  read<T>(identity:string,key:string,freshnessMs=this.freshnessMs):ReadValue<T>|null{
    if(!identity||identity!==this.identity)return null;
    const entry=this.entries.get(key);
    if(!entry||entry.identity!==identity)return null;
    this.entries.delete(key);this.entries.set(key,entry);
    return {value:entry.value as T,fresh:Date.now()-entry.updatedAt<freshnessMs,updatedAt:entry.updatedAt};
  }
  async load<T>(identity:string,key:string,loader:()=>Promise<T>,{force=false,freshnessMs=this.freshnessMs}:{force?:boolean;freshnessMs?:number}={}):Promise<T>{
    if(!identity||identity!==this.identity)throw new ObsoletePrivateQueryError();
    const cached=this.read<T>(identity,key,freshnessMs);
    if(!force&&cached?.fresh)return cached.value;
    const active=this.pending.get(key);
    if(active&&active.generation===this.generation)return active.promise as Promise<T>;
    if(this.pending.size>=this.maxPending)throw new Error('Too many private requests are already in progress.');
    const generation=this.generation;
    const promise=(async()=>{
      const value=await loader();
      if(generation!==this.generation||identity!==this.identity)throw new ObsoletePrivateQueryError();
      this.entries.delete(key);this.entries.set(key,{identity,value,updatedAt:Date.now()});
      while(this.entries.size>this.maxEntries)this.entries.delete(this.entries.keys().next().value!);
      this.emit('stored');
      return value;
    })().finally(()=>{if(this.pending.get(key)?.promise===promise)this.pending.delete(key)});
    this.pending.set(key,{generation,promise});
    return promise;
  }
  invalidate(identity:string){
    if(!identity||identity!==this.identity)return;
    this.drop();this.emit('mutation');
  }
  authorizationFailure(identity:string){
    if(!identity||identity!==this.identity)return;
    this.drop();this.emit('authorization');
  }
  subscribe(listener:(event:CacheEvent)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  get size(){return this.entries.size}
}

const cache=new SessionPrivateQueryCache();
export function setPrivateQueryIdentity(identity:string|null){cache.setIdentity(identity)}
export function readPrivateQuery<T>(identity:string,key:string){return cache.read<T>(identity,key)}
export function subscribePrivateQueries(listener:(event:CacheEvent)=>void){return cache.subscribe(listener)}
export function invalidatePrivateQueries(identity:string){cache.invalidate(identity)}

export async function loadPrivateJson<T>(identity:string,url:string,{force=false,freshnessMs}:{force?:boolean;freshnessMs?:number}={}):Promise<T>{
  return cache.load(identity,url,async()=>{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15_000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=body&&typeof body.error==='string'?body.error:'Could not load this page.';
      if(response.status===401||response.status===403){cache.authorizationFailure(identity);throw new PrivateAuthorizationError(message,response.status)}
      throw new Error(message);
    }
    return body as T;
  },{force,freshnessMs});
}
