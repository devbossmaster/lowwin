import type {Bot} from 'grammy';

type PhotoApi=Pick<Bot['api'],'sendPhoto'>;
type Photo=Parameters<PhotoApi['sendPhoto']>[1];
type Options=Parameters<PhotoApi['sendPhoto']>[2];
const photosByBot=new WeakMap<PhotoApi,Map<string,string>>();

/** Telegram file IDs belong to the sending bot. Reuse an immutable broadcast
 * image after its first successful upload, retaining each recipient's caption
 * and button. This cache changes no queue, retry or rate-limit decisions. */
export async function sendBroadcastPhoto(api:PhotoApi,chatId:string,photo:Photo,options:Options,contentKey:string){
 let photos=photosByBot.get(api);
 if(!photos){photos=new Map();photosByBot.set(api,photos)}
 const cached=photos.get(contentKey);
 let sent;
 try{sent=await api.sendPhoto(chatId,cached??photo,options)}
 catch(error){
  // A rejected cached file ID has not delivered a message. Refresh it once;
  // 429/403/network failures retain the dispatcher's existing retry policy.
  if(!cached||(error as {error_code?:number}).error_code!==400)throw error;
  photos.delete(contentKey);sent=await api.sendPhoto(chatId,photo,options);
 }
 const fileId=sent.photo?.at(-1)?.file_id;
 if(typeof fileId==='string'&&fileId.length>0&&fileId.length<=512){
  if(!photos.has(contentKey)&&photos.size>=32)photos.delete(photos.keys().next().value!);
  photos.set(contentKey,fileId);
 }
 return sent;
}
