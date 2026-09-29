import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readPublishedMedia,storePublishedMedia} from '../src/modules/media/published-cache';

describe('published media cache',()=>{
 let directory='',previousDirectory:string|undefined,previousAppEnv:string|undefined;
 beforeEach(async()=>{previousDirectory=process.env.LOWWIN_MEDIA_CACHE_DIR;previousAppEnv=process.env.APP_ENV;directory=await mkdtemp(join(tmpdir(),'lowwin-media-cache-'));process.env.LOWWIN_MEDIA_CACHE_DIR=directory;process.env.APP_ENV='production'});
 afterEach(async()=>{if(previousDirectory===undefined)delete process.env.LOWWIN_MEDIA_CACHE_DIR;else process.env.LOWWIN_MEDIA_CACHE_DIR=previousDirectory;if(previousAppEnv===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=previousAppEnv;const target=resolve(directory),root=resolve(tmpdir())+sep;if(!target.startsWith(root))throw Error('Unsafe temporary cache path');await rm(target,{recursive:true,force:true})});
 it('serves stored immutable bytes without another source read',async()=>{const id=randomUUID(),bytes=Buffer.from('published-image');expect(await readPublishedMedia(id)).toBeNull();await storePublishedMedia(id,bytes);expect(await readPublishedMedia(id)).toEqual(bytes)});
 it('fails closed in production when no persistent directory is configured',async()=>{delete process.env.LOWWIN_MEDIA_CACHE_DIR;await expect(readPublishedMedia(randomUUID())).rejects.toThrow('LOWWIN_MEDIA_CACHE_DIR is required')});
});
