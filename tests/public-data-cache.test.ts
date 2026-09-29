import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {cachedPublicData,clearPublicDataCache} from '../src/modules/cache/public-data';

describe('bounded public data cache',()=>{
 let appEnv:string|undefined,databaseUrl:string|undefined;
 beforeEach(()=>{appEnv=process.env.APP_ENV;databaseUrl=process.env.DATABASE_URL;process.env.APP_ENV='production';process.env.DATABASE_URL='postgresql://cache-test@127.0.0.1/cache_test';clearPublicDataCache()});
 afterEach(()=>{clearPublicDataCache();if(appEnv===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=appEnv;if(databaseUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=databaseUrl});
 it('deduplicates concurrent safe public reads',async()=>{let reads=0;const load=async()=>{reads++;await Promise.resolve();return {public:true}};const [one,two]=await Promise.all([cachedPublicData('catalog',1000,load),cachedPublicData('catalog',1000,load)]);expect(one).toEqual({public:true});expect(two).toEqual(one);expect(reads).toBe(1)});
 it('does not cache failures or cross database targets',async()=>{let reads=0;await expect(cachedPublicData('results',1000,async()=>{reads++;throw Error('temporary')})).rejects.toThrow('temporary');expect(await cachedPublicData('results',1000,async()=>++reads)).toBe(2);process.env.DATABASE_URL='postgresql://cache-test@127.0.0.1/other_test';expect(await cachedPublicData('results',1000,async()=>++reads)).toBe(3)});
 it('bypasses the shared cache outside production',async()=>{process.env.APP_ENV='staging';let reads=0;await cachedPublicData('catalog',1000,async()=>++reads);await cachedPublicData('catalog',1000,async()=>++reads);expect(reads).toBe(2)});
});
