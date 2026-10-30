import {beforeEach,describe,expect,it,vi} from 'vitest';
import {GrammyError,InputFile,type Api,type Bot} from 'grammy';
import type {PrismaClient} from '@prisma/client';
import sharp from 'sharp';
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
  expect(f.read).toHaveBeenCalledTimes(1);expect(String(f.read.mock.calls[0][0]).replaceAll('\\','/')).toMatch(/public\/images\/lowwin-home-banner-am\.webp$/);
  expect(send.sendMessage).not.toHaveBeenCalled();expect(send.sendPhoto).toHaveBeenCalledTimes(2);
  expect(send.sendPhoto.mock.calls[0][2]).toEqual({caption:'Caption one',reply_markup:keyboard});expect(send.sendPhoto.mock.calls[1][2]).toEqual({caption:'Caption two',reply_markup:keyboard});
  const photo=send.sendPhoto.mock.calls[0][1] as InputFile;expect(photo.filename).toBe('lowwin-welcome.jpg');
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

describe('post-contact launch banner',()=>{
 it.each([['VERIFIED',CONTACT_VERIFIED_MESSAGE],['ALREADY_VERIFIED',CONTACT_ALREADY_VERIFIED_MESSAGE]])('keeps the %s contact result and launch action on a photo',async(result,caption)=>{
  f.contact.mockResolvedValue(result);const send=api(),update=vi.fn(),handled=vi.fn(),tx={$queryRaw:vi.fn(async()=>[{updateId:1n,attempts:0,botId:'fixture-bot',payload:{message:{chat:{id:7,type:'private'},from:{id:7}}}}]),botUpdate:{update}};
  const client={$transaction:(run:(value:unknown)=>Promise<unknown>)=>run(tx)} as unknown as PrismaClient;
  const {processOneUpdate}=await import('../src/modules/bot/worker');expect(await processOneUpdate(client,{api:send,handleUpdate:handled} as unknown as Bot)).toBe(true);
  expect(send.sendMessage).toHaveBeenCalledExactlyOnceWith('7',CONTACT_KEYBOARD_REMOVED_MESSAGE,{reply_markup:{remove_keyboard:true}});
  expect(send.sendPhoto).toHaveBeenCalledTimes(1);expect(send.sendPhoto.mock.calls[0][2]).toMatchObject({caption,reply_markup:{inline_keyboard:[[{text:START_BIDDING_ACTION,web_app:{url:'https://lowwin.test/telegram'}}]]}});
  expect(handled).not.toHaveBeenCalled();expect(update).toHaveBeenCalledWith(expect.objectContaining({data:{processedAt:expect.any(Date),payload:{},lastError:null}}));
 });
});
