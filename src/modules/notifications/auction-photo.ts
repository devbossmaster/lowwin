import type {Prisma} from '@prisma/client';
import {InputFile} from 'grammy';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {auctionNotificationImagePath} from './campaigns';

const photos=new Map<string,Buffer>();
/** Upload the displayed product image directly: Telegram need not fetch a
 * protected media URL or understand WebP. Never substitute a generic banner. */
export async function auctionPhoto(tx:Prisma.TransactionClient,path:string){
 if(auctionNotificationImagePath({images:[{path}]})!==path)return null;
 const mediaId=/^\/api\/media\/([^/]+)$/.exec(path)?.[1];
 const localPath=mediaId?null:resolve('public','.'+path);
 if(localPath&&(!existsSync(localPath)||!statSync(localPath).isFile()))return null;
 const key=mediaId?'media:'+mediaId:`${localPath}:${statSync(localPath!).mtimeMs}`;
 let photo=photos.get(key);
 if(!photo){
  const media=mediaId?await tx.managedMedia.findUnique({where:{id:mediaId},select:{bytes:true}}):null;
  if(mediaId&&!media)return null;
  try{photo=await sharp(media?Buffer.from(media.bytes):localPath!,{limitInputPixels:32_000_000}).rotate().resize({width:1840,height:1840,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer()}
  catch{return null}
  if(photos.size>=10)photos.delete(photos.keys().next().value!);
  photos.set(key,photo);
 }
 return new InputFile(photo,'auction.jpg');
}
