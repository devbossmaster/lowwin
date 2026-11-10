import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import type {Api,Transformer} from 'grammy';
import {notificationSettings} from '../src/modules/notifications/settings';
import {canonicalTelegramChatId,installTelegramRateLimit,recordTelegramCooldown,reserveTelegramSend,telegramRateTransformer,TelegramRateDeferredError,withTelegramSendPolicy,telegramPolicyApi} from '../src/modules/notifications/telegram-rate';

describe('notification rate configuration',()=>{
 it('uses conservative ordinary limits and leaves capacity for personal messages',()=>{
  expect(notificationSettings({})).toMatchObject({NOTIFICATION_SEND_CONCURRENCY:4,TELEGRAM_SENDS_PER_SECOND:20,TELEGRAM_BULK_SENDS_PER_SECOND:16,TELEGRAM_PRIVATE_CHAT_INTERVAL_MS:1000,TELEGRAM_GROUP_CHAT_INTERVAL_MS:3000});
  for(const raw of [{TELEGRAM_SENDS_PER_SECOND:'30'},{TELEGRAM_SENDS_PER_SECOND:'20',TELEGRAM_BULK_SENDS_PER_SECOND:'20'},{TELEGRAM_PRIVATE_CHAT_INTERVAL_MS:'500'},{TELEGRAM_GROUP_CHAT_INTERVAL_MS:'2999'},{NOTIFICATION_SEND_CONCURRENCY:'99'}])expect(()=>notificationSettings(raw)).toThrow('Invalid notification configuration');
 });
 it('canonicalizes shared chat identities and rejects malformed destinations',()=>{
  expect(canonicalTelegramChatId('000123')).toBe('123');expect(canonicalTelegramChatId('-000123')).toBe('-123');expect(canonicalTelegramChatId('@LowwinChannel')).toBe('@lowwinchannel');expect(()=>canonicalTelegramChatId('https://t.me/a')).toThrow();
 });
 it('installs at most once on an API and never enables Stars spending',async()=>{
  const use=vi.fn(),api={config:{use}} as unknown as Pick<Api,'config'>;
  installTelegramRateLimit(api,{} as PrismaClient,'123456789:fixture_only_token');installTelegramRateLimit(api,{} as PrismaClient,'123456789:fixture_only_token');expect(use).toHaveBeenCalledTimes(1);
  const transformer=use.mock.calls[0][0] as Transformer,next=vi.fn();await expect(transformer(next as never,'sendMessage',{chat_id:1,text:'test',allow_paid_broadcast:true})).rejects.toThrow('Paid Telegram broadcasting is disabled');expect(next).not.toHaveBeenCalled();
 });
 it('runs Stop/ownership policy even with a simulated non-Grammy sender',async()=>{
  const send=vi.fn();await expect(withTelegramSendPolicy({beforeSend:()=>{throw Error('STOPPED')}},()=>telegramPolicyApi({sendMessage:send}).sendMessage())).rejects.toThrow('STOPPED');expect(send).not.toHaveBeenCalled();
 });
 it('does no eager gate during preparation and gates each actual fallback attempt once',async()=>{
  const gate=vi.fn(),send=vi.fn().mockRejectedValueOnce({error_code:400}).mockResolvedValue({message_id:1}),api=telegramPolicyApi({sendPhoto:send});
  await withTelegramSendPolicy({beforeSend:gate},async()=>{
   expect(gate).not.toHaveBeenCalled();
   await expect(api.sendPhoto()).rejects.toMatchObject({error_code:400});
   expect(gate).toHaveBeenCalledTimes(1);
   await api.sendPhoto();
  });
  expect(gate).toHaveBeenCalledTimes(2);expect(send).toHaveBeenCalledTimes(2);
 });
});

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('shared PostgreSQL Telegram budget',()=>{
 let db:PrismaClient,second:PrismaClient;const bots:string[]=[];
 const bot=()=>{const id=String(randomInt(700000000,800000000));bots.push(id);return id};
 const settings=notificationSettings({TELEGRAM_SENDS_PER_SECOND:'2',TELEGRAM_BULK_SENDS_PER_SECOND:'1'});
 const reset=async(id:string)=>db.$executeRaw`UPDATE "TelegramRateBudget" SET "nextSendAt"=clock_timestamp()-interval '1 day' WHERE "botId"=${id}`;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url});execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:url});second=new PrismaClient({datasourceUrl:url});
 },30000);
 afterAll(async()=>{if(db)for(const id of bots){await db.$executeRaw`DELETE FROM "TelegramChatRateBudget" WHERE "botId"=${id}`;await db.$executeRaw`DELETE FROM "TelegramRateBudget" WHERE "botId"=${id}`}await Promise.all([db?.$disconnect(),second?.$disconnect()])});
 it('coordinates concurrent workers without reserving future bulk slots',async()=>{
  const id=bot();const grants=await Promise.all(Array.from({length:10},(_,i)=>reserveTelegramSend(i%2?db:second,id,String(1000+i),'bulk',settings)));
  expect(grants.filter(grant=>grant.granted)).toHaveLength(1);expect(grants.filter(grant=>!grant.granted).every(grant=>grant.waitMs>0)).toBe(true);
  expect((await reserveTelegramSend(second,bot(),'1000','high',settings)).granted).toBe(true);
  const [state]=await db.$queryRaw<{nextBulkAt:Date;now:Date}[]>`SELECT "nextBulkAt",clock_timestamp() AS now FROM "TelegramRateBudget" WHERE "botId"=${id}`;
  expect(state.nextBulkAt.getTime()-state.now.getTime()).toBeLessThanOrEqual(1000);
 });
 it('enforces private and group cooldowns independently from the global slot',async()=>{
  const id=bot();expect((await reserveTelegramSend(db,id,'123','high',settings)).granted).toBe(true);await reset(id);
  const privateWait=await reserveTelegramSend(second,id,'000123','high',settings);expect(privateWait.granted).toBe(false);expect(privateWait.waitMs).toBeGreaterThan(850);
  expect((await reserveTelegramSend(db,id,'456','high',settings)).granted).toBe(true);await reset(id);
  expect((await reserveTelegramSend(db,id,'-100123','high',settings)).granted).toBe(true);await reset(id);
  const groupWait=await reserveTelegramSend(second,id,'-100123','high',settings);expect(groupWait.granted).toBe(false);expect(groupWait.waitMs).toBeGreaterThan(2850);
 });
 it('shares 429 cooldowns with every worker and chat for the affected bot only',async()=>{
  const id=bot(),until=await recordTelegramCooldown(db,id,2),denied=await reserveTelegramSend(second,id,'555','high',settings);
  expect(denied.granted).toBe(false);expect(denied.retryAt.getTime()).toBeGreaterThanOrEqual(until.getTime());expect(denied.waitMs).toBeGreaterThan(1850);
  expect((await reserveTelegramSend(second,bot(),'555','bulk',settings)).granted).toBe(true);
 });
 it('gives eligible waiting bulk a turn after four personal grants',async()=>{
  const id=bot();await reserveTelegramSend(db,id,'501','high',settings);
  await db.$executeRaw`UPDATE "TelegramRateBudget" SET "nextSendAt"=clock_timestamp()-interval '1 day',"nextBulkAt"=clock_timestamp()-interval '1 day',"highStreak"=4,"bulkWaitingUntil"=clock_timestamp()+interval '1 second' WHERE "botId"=${id}`;
  expect((await reserveTelegramSend(second,id,'502','high',settings)).granted).toBe(false);
  expect((await reserveTelegramSend(db,id,'503','bulk',settings)).granted).toBe(true);await reset(id);
  expect((await reserveTelegramSend(second,id,'504','high',settings)).granted).toBe(true);
 });
 it('defers long cooldowns before HTTP without holding a lane for the whole retry_after',async()=>{
  const id=bot();await recordTelegramCooldown(db,id,20);const next=vi.fn(),transformer=telegramRateTransformer(second,id,{...settings,TELEGRAM_RATE_MAX_WAIT_MS:100});
  await expect(transformer(next as never,'sendMessage',{chat_id:123,text:'fixture'})).rejects.toBeInstanceOf(TelegramRateDeferredError);expect(next).not.toHaveBeenCalled();
 });
 it('honors Stop after a denied quota wait before making any HTTP request',async()=>{
  const id=bot();await reserveTelegramSend(db,id,'600','high',settings);
  let stopped=false;const next=vi.fn(),transformer=telegramRateTransformer(second,id,settings),stop=setTimeout(()=>{stopped=true},25);
  try{
   await expect(withTelegramSendPolicy({beforeSend:()=>{if(stopped)throw Error('CAMPAIGN_STOPPED')}},()=>transformer(next as never,'sendMessage',{chat_id:601,text:'fixture'}))).rejects.toThrow('CAMPAIGN_STOPPED');
   expect(next).not.toHaveBeenCalled();
  }finally{clearTimeout(stop)}
 });
 it('records raw API 429 responses and checks delivery ownership immediately before HTTP',async()=>{
  const id=bot(),next=vi.fn(async()=>({ok:false,error_code:429,description:'Too many requests',parameters:{retry_after:3}})),transformer=telegramRateTransformer(db,id,settings);
  const response=await transformer(next as never,'sendMessage',{chat_id:123,text:'fixture'});expect(response.ok).toBe(false);expect(next).toHaveBeenCalledTimes(1);
  expect((await reserveTelegramSend(second,id,'456','high',settings)).waitMs).toBeGreaterThan(2800);
  let checks=0;const noSend=vi.fn(),stopped=telegramRateTransformer(db,bot(),settings);
  await expect(withTelegramSendPolicy({beforeSend:()=>{checks++;throw Error('STOPPED')}},()=>stopped(noSend as never,'sendMessage',{chat_id:123,text:'fixture'}))).rejects.toThrow('STOPPED');expect(noSend).not.toHaveBeenCalled();expect(checks).toBe(1);
 });
});
