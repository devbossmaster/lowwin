import {createHash} from 'node:crypto';

type Entry={expiresAt:number;value:Promise<unknown>};
const globalCache=globalThis as unknown as {lowwinPublicDataCache?:Map<string,Entry>};
const entries=globalCache.lowwinPublicDataCache??new Map<string,Entry>();
globalCache.lowwinPublicDataCache=entries;
const MAX_ENTRIES=128;

function namespace(){return createHash('sha256').update(process.env.DATABASE_URL??'unconfigured').digest('hex').slice(0,16)}
export async function cachedPublicData<T>(key:string,ttlMs:number,load:()=>Promise<T>):Promise<T>{
 if(process.env.APP_ENV!=='production')return load();
 const scoped=`${namespace()}:${key}`,now=Date.now(),current=entries.get(scoped);
 if(current&&current.expiresAt>now)return current.value as Promise<T>;
 if(current)entries.delete(scoped);
 const value=load();entries.set(scoped,{expiresAt:now+ttlMs,value});
 while(entries.size>MAX_ENTRIES)entries.delete(entries.keys().next().value!);
 try{return await value}catch(error){if(entries.get(scoped)?.value===value)entries.delete(scoped);throw error}
}
export function clearPublicDataCache(){entries.clear()}
