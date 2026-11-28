import {GrammyError,InputFile,type Api} from 'grammy';
import type {InlineKeyboardMarkup,ReplyKeyboardMarkup} from 'grammy/types';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {LOWWIN_HOME_BANNER_SRC} from '@/lib/brand';
import {defaultHomeCopy} from '@/components/home-copy';

type Language='en'|'am';
const artwork=new Map<string,Promise<Buffer>>();
const banners=new Map<Language,Promise<Buffer>>();
const fontfile=resolve('public/fonts/NotoSansEthiopic-Bold.ttf');

async function renderWelcomeBanner(bytes:Buffer,language:Language){
 const {data,info}=await sharp(bytes).rotate().resize(1200).raw().toBuffer({resolveWithObject:true});
 const headline=(language==='am'?defaultHomeCopy.headlineAm:defaultHomeCopy.headline).replace(/([.።]) /,'$1\n');
 const lead=language==='am'?defaultHomeCopy.leadAm:defaultHomeCopy.lead.replace(' bid','\nbid');
 const typeface=language==='am'?{font:'Noto Sans Ethiopic Bold',fontfile}:{font:'sans-serif Bold'};
 const layers=await Promise.all([
  {copy:headline,color:'#FFFFFF',size:57,gap:24},
  {copy:lead,color:'#D8E9FF',size:33,gap:0},
 ].map(async ({copy,color,size,gap})=>{
  const text={...typeface,text:`<span foreground="${color}">${copy}</span>`,font:`${typeface.font} ${size}`,width:320,rgba:true};
  const layer=await sharp({text}).png().toBuffer({resolveWithObject:true});
  return {input:layer.data,height:layer.info.height,gap};
 }));
 const height=layers.reduce((sum,layer)=>sum+layer.height+layer.gap,0);
 let top=Math.floor((info.height-height)/2)-12;
 const overlays=layers.map(layer=>{
  const overlay={input:layer.input,left:48,top};
  top+=layer.height+layer.gap;
  return overlay;
 });
 return sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}}).composite(overlays).jpeg({quality:85,mozjpeg:true}).toBuffer();
}

function welcomeBanner(language:Language){
 let banner=banners.get(language);
 if(!banner){
  const path=LOWWIN_HOME_BANNER_SRC[language];
  let source=artwork.get(path);
  if(!source){
   source=readFile(resolve('public'+path)).catch(error=>{artwork.delete(path);throw error});
   artwork.set(path,source);
  }
  banner=source.then(bytes=>renderWelcomeBanner(bytes,language)).catch(error=>{banners.delete(language);throw error});
  banners.set(language,banner);
 }
 return banner;
}
export async function sendWelcomeBanner(api:Pick<Api,'sendPhoto'|'sendMessage'>,chatId:string|number,caption:string,reply_markup:InlineKeyboardMarkup|ReplyKeyboardMarkup,language:Language='am'){
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
