import {GrammyError,InputFile,type Api} from 'grammy';
import type {InlineKeyboardMarkup,ReplyKeyboardMarkup} from 'grammy/types';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {LOWWIN_BANNER_SRC} from '@/lib/brand';

// Upload the existing public Home artwork directly as a compact JPEG. Telegram
// need not fetch a protected/app-relative URL or decode WebP. Cache only these
// two public assets, never recipient or contact data.
const banners=new Map<string,Promise<Buffer>>();
function welcomeBanner(language:'en'|'am'){
 const path=LOWWIN_BANNER_SRC[language];
 let banner=banners.get(path);
 if(!banner){banner=readFile(resolve('public'+path)).then(bytes=>sharp(bytes).rotate().jpeg({quality:85,mozjpeg:true}).toBuffer()).catch(error=>{banners.delete(path);throw error});banners.set(path,banner)}
 return banner;
}
export async function sendWelcomeBanner(api:Pick<Api,'sendPhoto'|'sendMessage'>,chatId:string|number,caption:string,reply_markup:InlineKeyboardMarkup|ReplyKeyboardMarkup,language:'en'|'am'='am'){
 let photo:Buffer;
 try{photo=await welcomeBanner(language)}catch{await api.sendMessage(chatId,caption,{reply_markup});return}
 try{await api.sendPhoto(chatId,new InputFile(photo,'lowwin-welcome.jpg'),{caption,reply_markup})}
 catch(error){
  // A rejected photo has not delivered a message. Transport/permission errors
  // remain retryable through the existing durable bot-update handling.
  if(!(error instanceof GrammyError&&error.error_code===400))throw error;
  await api.sendMessage(chatId,caption,{reply_markup});
 }
}
