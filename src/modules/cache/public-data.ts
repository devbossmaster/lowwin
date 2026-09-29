import {publicCacheScope,readSharedPublicData,writeSharedPublicData,invalidateSharedPublicData} from './redis-public';

type Entry={expiresAt:number;value:Promise<unknown>};
const globalCache=globalThis as unknown as {lowwinPublicDataCache?:Map<string,Entry>};
const entries=globalCache.lowwinPublicDataCache??new Map<string,Entry>();
globalCache.lowwinPublicDataCache=entries;
const MAX_ENTRIES=128;

/** Public JSON DTOs only. Never pass sessions, private bids, balances or proofs. */
export async function cachedPublicData<T>(key:string,ttlMs:number,load:()=>Promise<T>):Promise<T>{
 if(process.env.APP_ENV!=='production')return load();
 const scope=publicCacheScope(),shared=await readSharedPublicData(scope,key);
 if(shared?.hit)return shared.value as T;
 const scoped=`${scope}:${shared?.generation??'local'}:${key}`,now=Date.now(),current=entries.get(scoped);
 if(current&&current.expiresAt>now)return current.value as Promise<T>;
 if(current)entries.delete(scoped);
 const value=load().then(async result=>{if(shared)await writeSharedPublicData(scope,key,shared.generation,result,ttlMs);return result});entries.set(scoped,{expiresAt:now+ttlMs,value});
 while(entries.size>MAX_ENTRIES)entries.delete(entries.keys().next().value!);
 try{return await value}catch(error){if(entries.get(scoped)?.value===value)entries.delete(scoped);throw error}
}
export async function clearPublicDataCache(){entries.clear();if(process.env.APP_ENV==='production')await invalidateSharedPublicData(publicCacheScope())}
