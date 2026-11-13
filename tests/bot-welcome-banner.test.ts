import {beforeEach,describe,expect,it,vi} from 'vitest';
import {GrammyError,InputFile,type Api,type Bot} from 'grammy';
import type {PrismaClient} from '@prisma/client';
import sharp from 'sharp';
import {LOWWIN_BANNER_SRC} from '../src/lib/brand';
import {CONTACT_ALREADY_VERIFIED_MESSAGE,CONTACT_VERIFIED_MESSAGE,CONTACT_KEYBOARD_REMOVED_MESSAGE,START_BIDDING_ACTION} from '../src/modules/bot/onboarding-copy';

const f=vi.hoisted(()=>({read:vi.fn(),contact:vi.fn()}));
vi.mock('node:fs/promises',()=>({readFile:f.read}));
vi.mock('../src/modules/auth/own-contact',()=>({acceptOwnContact:f.contact,contactBotId:()=> 'fixture-bot',isRegisteredTelegramUser:vi.fn()}));
vi.mock('../src/lib/env',()=>({getEnv:()=>({MINI_APP_URL:'https://lowwin.test/telegram'})}));
const keyboard={keyboard:[[{text:'Share contact',request_contact:true}]],resize_keyboard:true};
function api(){return {sendMessage:vi.fn(async(..._args:unknown[])=>({message_id:1})),sendPhoto:vi.fn(async(..._args:unknown[])=>({message_id:2}))}}
beforeEach(async()=>{vi.resetModules();vi.clearAllMocks();f.read.mockResolvedValue(await sharp({create:{width:140,height:76,channels:3,background:'#c5a52b'}}).webp().toBuffer())});

describe('public welcome banner delivery without real Telegram requests',()=>{
 it('converts and caches only the public Home artwork while preserving each caption and keyboard',async()=>{
  const {sendWelcomeBanner}=await import('../src/modules/bot/welcome-banner'),send=api();
  await sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'first','Caption one',keyboard);
  await sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'second','Caption two',keyboard);
  expect(f.read).toHaveBeenCalledTimes(1);expect(String(f.read.mock.calls[0][0]).replaceAll('\\','/')).toMatch(new RegExp('public'+LOWWIN_BANNER_SRC.am.replaceAll('.','\\.')+'$'));
  expect(send.sendMessage).not.toHaveBeenCalled();expect(send.sendPhoto).toHaveBeenCalledTimes(2);
  expect(send.sendPhoto.mock.calls[0][2]).toEqual({caption:'Caption one',reply_markup:keyboard});expect(send.sendPhoto.mock.calls[1][2]).toEqual({caption:'Caption two',reply_markup:keyboard});
  const photo=send.sendPhoto.mock.calls[0][1] as InputFile;expect(photo.filename).toBe('lowwin-welcome.jpg');
 });
 it('selects the existing English or Amharic artwork and caches each language separately',async()=>{
  const {sendWelcomeBanner}=await import('../src/modules/bot/welcome-banner'),send=api();
  for(const language of ['en','am','en','am'] as const)await sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'fixture','Caption',keyboard,language);
  expect(f.read).toHaveBeenCalledTimes(2);expect(f.read.mock.calls.map(call=>String(call[0]).replaceAll('\\','/').split('/').at(-1))).toEqual([LOWWIN_BANNER_SRC.en.split('/').at(-1),LOWWIN_BANNER_SRC.am.split('/').at(-1)]);expect(send.sendPhoto).toHaveBeenCalledTimes(4);expect(send.sendMessage).not.toHaveBeenCalled();
 });
 it('keeps the original text and controls when the local asset is unavailable',async()=>{
  f.read.mockRejectedValueOnce(Object.assign(Error('Missing public asset'),{code:'ENOENT'}));
  const {sendWelcomeBanner}=await import('../src/modules/bot/welcome-banner'),send=api();
  await sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'first','Exact fallback caption',keyboard);
  expect(send.sendPhoto).not.toHaveBeenCalled();expect(send.sendMessage).toHaveBeenCalledExactlyOnceWith('first','Exact fallback caption',{reply_markup:keyboard});
 });
 it('falls back to the same text when Telegram rejects the photo',async()=>{
  const {sendWelcomeBanner}=await import('../src/modules/bot/welcome-banner'),send=api();send.sendPhoto.mockRejectedValueOnce(new GrammyError('Rejected photo',{ok:false,error_code:400,description:'Bad Request'},'sendPhoto',{}));
  await sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'first','Exact fallback caption',keyboard);
  expect(send.sendMessage).toHaveBeenCalledExactlyOnceWith('first','Exact fallback caption',{reply_markup:keyboard});
 });
 it.each([Error('Transport interrupted'),new GrammyError('Denied',{ok:false,error_code:403,description:'Forbidden'},'sendPhoto',{})])('keeps uncertain or denied delivery retryable without a duplicate fallback',async cause=>{
  const {sendWelcomeBanner}=await import('../src/modules/bot/welcome-banner'),send=api();send.sendPhoto.mockRejectedValueOnce(cause);
  await expect(sendWelcomeBanner(send as unknown as Pick<Api,'sendPhoto'|'sendMessage'>,'first','Caption',keyboard)).rejects.toBe(cause);expect(send.sendMessage).not.toHaveBeenCalled();
 });
});

describe('post-contact durable delivery',()=>{
 it.each(['VERIFIED','ALREADY_VERIFIED'])('commits %s without waiting for Telegram/media and queues only the first confirmation',async result=>{
  f.contact.mockResolvedValue(result);const send=api(),update=vi.fn(),enqueue=vi.fn(),handled=vi.fn();
  const tx={$queryRaw:vi.fn(async()=>[{updateId:1n,attempts:0,botId:'fixture-bot',payload:{message:{chat:{id:7,type:'private'},from:{id:7}}}}]),botUpdate:{update},outbox:{upsert:enqueue}};
  let committed=false;
  const client={$transaction:async(run:(value:unknown)=>Promise<unknown>)=>{const result=await run(tx);committed=true;return result}} as unknown as PrismaClient;
  const {processOneUpdate}=await import('../src/modules/bot/worker');expect(await processOneUpdate(client,{api:send,handleUpdate:handled} as unknown as Bot)).toBe(true);
  expect(committed).toBe(true);expect(send.sendMessage).not.toHaveBeenCalled();expect(send.sendPhoto).not.toHaveBeenCalled();expect(handled).not.toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalledTimes(result==='VERIFIED'?1:0);
  if(result==='VERIFIED')expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({kind:'CONTACT_CONFIRMED',payload:{telegramId:'7',botId:'fixture-bot'}})}));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({data:{processedAt:expect.any(Date),payload:{},lastError:null}}));
 });
});
