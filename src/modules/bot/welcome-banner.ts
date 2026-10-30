import {GrammyError,InputFile,type Api} from 'grammy';
import type {InlineKeyboardMarkup,ReplyKeyboardMarkup} from 'grammy/types';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';

// Reuse the current Amharic Home artwork; Telegram receives a compact JPEG.
// Keep only this public asset in memory, never recipient or contact data.
let banner:Promise<Buffer>|null=null;
function welcomeBanner(){
 if(!banner)banner=readFile(resolve('public/images/lowwin-home-banner-am.webp')).then(bytes=>sharp(bytes).rotate().jpeg({quality:85,mozjpeg:true}).toBuffer()).catch(error=>{banner=null;throw error});
 return banner;
}
export async function sendWelcomeBanner(api:Pick<Api,'sendPhoto'|'sendMessage'>,chatId:string|number,caption:string,reply_markup:InlineKeyboardMarkup|ReplyKeyboardMarkup){
 let photo:Buffer;
 try{photo=await welcomeBanner()}catch{await api.sendMessage(chatId,caption,{reply_markup});return}
 try{await api.sendPhoto(chatId,new InputFile(photo,'lowwin-welcome.jpg'),{caption,reply_markup})}
 catch(error){
  // A rejected photo has not delivered a message. Transport/permission errors
  // remain retryable through the existing durable bot-update handling.
  if(!(error instanceof GrammyError&&error.error_code===400))throw error;
  await api.sendMessage(chatId,caption,{reply_markup});
 }
}
