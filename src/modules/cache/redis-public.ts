import {createHash,randomUUID} from 'node:crypto';
import {createClient} from 'redis';

function makeClient(url:string){return createClient({url,disableOfflineQueue:true,socket:{connectTimeout:500,reconnectStrategy:false}})}
type Client=ReturnType<typeof makeClient>;
type State={url:string;client:Client;connecting?:Promise<unknown>;retryAt:number};
const globalCache=globalThis as unknown as {lowwinRedisPublic?:State;lowwinRedisWarningAt?:number};
const MAX_BYTES=512*1024;

export function publicCacheScope(){
 const db=new URL(process.env.DATABASE_URL??'postgresql://unconfigured/local');
 const identity=[process.env.APP_ENV,process.env.REDIS_CACHE_NAMESPACE??'lowwin',db.host,db.pathname,db.username].join('|');
 return `lowwin:public:v2:${createHash('sha256').update(identity).digest('hex').slice(0,24)}`;
}
async function useRedis<T>(operation:(client:Client)=>Promise<T>):Promise<T|undefined>{
 const url=process.env.REDIS_URL?.trim();if(!url)return undefined;
 let state=globalCache.lowwinRedisPublic;
 if(state?.url===url&&state.retryAt>Date.now())return undefined;
 try{
  if(!state||state.url!==url||(!state.client.isOpen&&!state.connecting)){
   if(state?.client.isOpen)state.client.destroy();
   const parsed=new URL(url);
   if(!['redis:','rediss:'].includes(parsed.protocol)||(process.env.APP_ENV==='production'&&!parsed.password))throw Error('Invalid Redis configuration');
   const client=makeClient(url);
   client.on('error',()=>{/* Commands log a sanitized failure; never log URLs. */});
   state={url,client,retryAt:0};globalCache.lowwinRedisPublic=state;
  }
  const current=state;
  if(!current)return undefined;
  if(!current.client.isReady){current.connecting??=current.client.connect().finally(()=>{current.connecting=undefined});await current.connecting}
  return await operation(current.client.withCommandOptions({timeout:500}) as Client);
 }catch{
  if(state){state.retryAt=Date.now()+5000;if(state.client.isOpen)state.client.destroy()}
  if((globalCache.lowwinRedisWarningAt??0)<Date.now()){console.warn('Public Redis cache unavailable; using bounded local cache.');globalCache.lowwinRedisWarningAt=Date.now()+30000}
  return undefined;
 }
}
function dataKey(scope:string,generation:string,key:string){return `${scope}:${generation}:${createHash('sha256').update(key).digest('hex')}`}
export type SharedRead={generation:string;hit:boolean;value?:unknown};
export async function readSharedPublicData(scope:string,key:string):Promise<SharedRead|undefined>{
 return useRedis(async client=>{
  const generationKey=`${scope}:generation`;
  let generation=await client.get(generationKey);
  if(!generation){await client.set(generationKey,randomUUID(),{NX:true});generation=await client.get(generationKey)}
  // Eviction creates a fresh generation, never reuses an old default key.
  if(!generation)throw Error('Redis generation unavailable');
  const raw=await client.get(dataKey(scope,generation,key));
  if(raw&&Buffer.byteLength(raw)<=MAX_BYTES){try{const entry=JSON.parse(raw);if(entry.version===1&&'value' in entry)return {generation,hit:true,value:entry.value}}catch{/* Corrupt cache is a miss. */}}
  return {generation,hit:false};
 });
}
export async function writeSharedPublicData(scope:string,key:string,generation:string,value:unknown,ttlMs:number){
 const raw=JSON.stringify({version:1,value});if(Buffer.byteLength(raw)>MAX_BYTES)return;
 await useRedis(client=>client.set(dataKey(scope,generation,key),raw,{PX:Math.max(1,Math.min(ttlMs,5000))}));
}
export async function invalidateSharedPublicData(scope:string){
 // In-flight writers retain their old generation, so cannot restore stale data.
 await useRedis(client=>client.set(`${scope}:generation`,randomUUID()));
}
