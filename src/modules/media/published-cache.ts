import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';

function cacheDirectory(){
 const configured=process.env.LOWWIN_MEDIA_CACHE_DIR?.trim();
 if(!configured){if(process.env.APP_ENV==='production')throw new Error('LOWWIN_MEDIA_CACHE_DIR is required in production.');return null}
 if(process.env.APP_ENV==='production'&&!isAbsolute(configured))throw new Error('LOWWIN_MEDIA_CACHE_DIR must be an absolute path in production.');
 return resolve(configured);
}
function pathFor(directory:string,id:string){return join(directory,`${id}.png`)}
export async function readPublishedMedia(id:string){
 const directory=cacheDirectory();if(!directory)return null;
 try{return await readFile(pathFor(directory,id))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.error('Published media cache read failed.');return null}
}
export async function storePublishedMedia(id:string,bytes:Uint8Array){
 const directory=cacheDirectory();if(!directory)return;
 const destination=pathFor(directory,id),temporary=join(directory,`.${id}.${randomUUID()}.tmp`);
 try{await mkdir(directory,{recursive:true,mode:0o750});await writeFile(temporary,bytes,{flag:'wx',mode:0o640});await rename(temporary,destination)}catch{console.error('Published media cache write failed.')}finally{await unlink(temporary).catch(()=>{})}
}
