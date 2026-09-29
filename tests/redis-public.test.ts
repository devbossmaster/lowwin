import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fake=vi.hoisted(()=>{
 const rows=new Map<string,{value:string;expires:number}>();
 const client={isOpen:false,isReady:false,on:vi.fn(),withCommandOptions:()=>client,
  connect:vi.fn(async()=>{client.isOpen=true;client.isReady=true;return client}),
  destroy:vi.fn(()=>{client.isOpen=false;client.isReady=false}),
  get:vi.fn(async(key:string)=>{const row=rows.get(key);return row&&row.expires>Date.now()?row.value:null}),
  set:vi.fn(async(key:string,value:string,options?:{NX?:boolean;PX?:number})=>{if(options?.NX&&rows.has(key))return null;rows.set(key,{value,expires:options?.PX?Date.now()+options.PX:Infinity});return 'OK'})};
 return {rows,client};
});
vi.mock('redis',()=>({createClient:()=>fake.client}));
import {cachedPublicData,clearPublicDataCache} from '../src/modules/cache/public-data';

describe('Redis public cache',()=>{
 beforeEach(async()=>{
  vi.stubEnv('APP_ENV','production');vi.stubEnv('DATABASE_URL','postgresql://test@localhost/cache_test');vi.stubEnv('REDIS_URL',`redis://default:${'a'.repeat(64)}@localhost:6379`);
  delete (globalThis as {lowwinRedisPublic?:unknown}).lowwinRedisPublic;
  fake.rows.clear();fake.client.isOpen=false;fake.client.isReady=false;vi.clearAllMocks();await clearPublicDataCache();
 });
 afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();delete (globalThis as {lowwinRedisPublic?:unknown}).lowwinRedisPublic});
 function clearLocal(){(globalThis as {lowwinPublicDataCache?:Map<string,unknown>}).lowwinPublicDataCache?.clear()}
 it('serves the shared JSON copy without loading PostgreSQL again',async()=>{
  const load=vi.fn(async()=>({items:[{code:'123'}],serverNow:'2026-09-29T12:00:00.000Z'}));
  const first=await cachedPublicData('catalog',3000,load);clearLocal();
  expect(await cachedPublicData('catalog',3000,load)).toEqual(first);expect(load).toHaveBeenCalledTimes(1);
 });
 it('expires shared entries and refetches',async()=>{
  vi.useFakeTimers();const load=vi.fn(async()=>({count:load.mock.calls.length}));
  await cachedPublicData('catalog',1000,load);clearLocal();vi.advanceTimersByTime(1001);
  await cachedPublicData('catalog',1000,load);expect(load).toHaveBeenCalledTimes(2);
 });
 it('cannot restore invalidated data from an in-flight loader',async()=>{
  let finish!:(value:{old:boolean})=>void,started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve});
  const pending=cachedPublicData('catalog',3000,()=>{started();return new Promise<{old:boolean}>(resolve=>{finish=resolve})});
  await ready;await clearPublicDataCache();finish({old:true});await pending;clearLocal();
  const load=vi.fn(async()=>({old:false}));expect(await cachedPublicData('catalog',3000,load)).toEqual({old:false});expect(load).toHaveBeenCalledOnce();
 });
 it('falls back to a bounded local cache on Redis failure without logging secrets',async()=>{
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});fake.client.get.mockRejectedValueOnce(Error('secret Redis URL'));
  const load=vi.fn(async()=>({ok:true}));expect(await cachedPublicData('catalog',3000,load)).toEqual({ok:true});expect(await cachedPublicData('catalog',3000,load)).toEqual({ok:true});expect(load).toHaveBeenCalledOnce();expect(JSON.stringify(warning.mock.calls)).not.toContain('secret Redis URL');
 });
});
