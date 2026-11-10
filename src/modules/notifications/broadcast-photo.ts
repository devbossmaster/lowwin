import type {Bot} from 'grammy';
import type {PrismaClient} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';

type PhotoApi=Pick<Bot['api'],'sendPhoto'>;
type Photo=Parameters<PhotoApi['sendPhoto']>[1];
type Options=Parameters<PhotoApi['sendPhoto']>[2];
const photosByBot=new WeakMap<PhotoApi,Map<string,string>>();
const persistentIds=new WeakMap<PrismaClient,Map<string,{fileId:string;until:number}>>();
type Source=Photo|(()=>Promise<Photo|null>);
export class TelegramMediaDeferredError extends Error{constructor(readonly retryAt:Date){super('Telegram media upload is already in progress')}}
type Persistent={client:PrismaClient;botId:string};

async function persistentPhoto(api:PhotoApi,chatId:string,source:Source,options:Options,contentKey:string,{client,botId}:Persistent,refresh=true):Promise<Awaited<ReturnType<PhotoApi['sendPhoto']>>|null>{
 const key=createHash('sha256').update(contentKey).digest('hex'),where={botId_contentKey:{botId,contentKey:key}},memoryKey=botId+':'+key;
 let memory=persistentIds.get(client);if(!memory){memory=new Map();persistentIds.set(client,memory)}
 const cached=memory.get(memoryKey),saved=cached&&cached.until>performance.now()?cached:await client.telegramMediaCache.findUnique({where,select:{fileId:true}});
 const token=randomUUID();let owner=false;
 if(!saved?.fileId){
  const acquired=await client.$queryRaw<{botId:string}[]>`INSERT INTO "TelegramMediaCache" ("botId","contentKey","uploadToken","uploadLeaseUntil","updatedAt") VALUES (${botId},${key},${token},clock_timestamp()+interval '120 seconds',clock_timestamp()) ON CONFLICT("botId","contentKey") DO UPDATE SET "uploadToken"=EXCLUDED."uploadToken","uploadLeaseUntil"=EXCLUDED."uploadLeaseUntil","updatedAt"=clock_timestamp() WHERE "TelegramMediaCache"."fileId" IS NULL AND ("TelegramMediaCache"."uploadToken" IS NULL OR "TelegramMediaCache"."uploadLeaseUntil"<=clock_timestamp()) RETURNING "botId"`;
  if(!acquired.length)throw new TelegramMediaDeferredError(new Date(Date.now()+1000));
  owner=true;
 }
 try{
  const photo=saved?.fileId??(typeof source==='function'?await source():source);
  if(!photo)return null;
  const sent=await api.sendPhoto(chatId,photo,options),fileId=sent.photo?.at(-1)?.file_id;
  // A cache acknowledgement cannot turn an accepted Telegram send into a
  // transport failure. Delivery state/message ID are committed separately.
  if(owner&&typeof fileId==='string'&&fileId.length>0&&fileId.length<=512)await client.telegramMediaCache.updateMany({where:{botId,contentKey:key,uploadToken:token},data:{fileId,uploadToken:null,uploadLeaseUntil:null}}).catch(()=>{});
  if(typeof fileId==='string'&&fileId.length>0&&fileId.length<=512){
   if(memory.size>=32&&!memory.has(memoryKey))memory.delete(memory.keys().next().value!);
   memory.set(memoryKey,{fileId,until:performance.now()+60_000});
  }
  return sent;
 }catch(error){
  if(saved?.fileId&&refresh&&(error as {error_code?:number}).error_code===400){
   memory.delete(memoryKey);
   await client.telegramMediaCache.updateMany({where:{botId,contentKey:key,fileId:saved.fileId},data:{fileId:null}});
   return persistentPhoto(api,chatId,source,options,contentKey,{client,botId},false);
  }
  throw error;
 }finally{
  // On a database outage the upload lease expires naturally. Preserve the
  // provider outcome (including 429) instead of replacing it with this error.
  if(owner)await client.telegramMediaCache.updateMany({where:{botId,contentKey:key,uploadToken:token},data:{uploadToken:null,uploadLeaseUntil:null}}).catch(()=>{});
 }
}

/** Telegram file IDs belong to the sending bot. Reuse an immutable broadcast
 * image after its first successful upload, retaining each recipient's caption
 * and button. This cache changes no queue, retry or rate-limit decisions. */
export async function sendBroadcastPhoto(api:PhotoApi,chatId:string,source:Source,options:Options,contentKey:string,persistent?:Persistent){
 if(persistent)return persistentPhoto(api,chatId,source,options,contentKey,persistent);
 let photos=photosByBot.get(api);
 if(!photos){photos=new Map();photosByBot.set(api,photos)}
 const cached=photos.get(contentKey);
 const prepare=()=>typeof source==='function'?source():Promise.resolve(source);
 let sent;
 try{const photo=cached??await prepare();if(!photo)return null;sent=await api.sendPhoto(chatId,photo,options)}
 catch(error){
  // A rejected cached file ID has not delivered a message. Refresh it once;
  // 429/403/network failures retain the dispatcher's existing retry policy.
  if(!cached||(error as {error_code?:number}).error_code!==400)throw error;
  photos.delete(contentKey);const photo=await prepare();if(!photo)return null;sent=await api.sendPhoto(chatId,photo,options);
 }
 const fileId=sent.photo?.at(-1)?.file_id;
 if(typeof fileId==='string'&&fileId.length>0&&fileId.length<=512){
  if(!photos.has(contentKey)&&photos.size>=32)photos.delete(photos.keys().next().value!);
  photos.set(contentKey,fileId);
 }
 return sent;
}
