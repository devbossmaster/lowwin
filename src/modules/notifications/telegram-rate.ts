import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import type {PrismaClient} from '@prisma/client';
import type {Api,Transformer} from 'grammy';
import {notificationSettings,type NotificationSettings} from './settings';
import {recordNotificationTiming,timeNotification} from './diagnostics';
import {notificationSendCapacityReady} from './notification-db-path';

export type TelegramSendPriority='high'|'bulk';
export type TelegramSendGrant={granted:boolean;waitMs:number;retryAt:Date};
export type TelegramSendReservation={botId:string;chatId:string;priority:TelegramSendPriority;globalMs:number;bulkMs:number;chatMs:number};
type SendPolicy={priority?:TelegramSendPriority;beforeSend?:()=>Promise<void>|void;reserveBeforeSend?:(reservation:TelegramSendReservation)=>Promise<TelegramSendGrant|null>};
const policies=new AsyncLocalStorage<SendPolicy>();
const installed=new WeakSet<object>();

/** Propagates delivery ownership/Stop checks through photo helpers and API calls. */
export function withTelegramSendPolicy<T>(policy:SendPolicy,operation:()=>Promise<T>){return policies.run(policy,operation)}

/** Real APIs run the gate in their installed transformer. This facade keeps
 * uninstrumented adapters/test transports gated per actual attempt too, without
 * running a duplicate gate before content/media preparation. */
export function telegramPolicyApi<T extends object>(api:T):T{
 if(installed.has(api))return api;
 return new Proxy(api,{get(target,key){
  const value=Reflect.get(target,key);
  if(typeof key!=='string'||!meteredMethods.has(key)||typeof value!=='function')return value;
  return async(...args:unknown[])=>{await timeNotification('gate',async()=>{await policies.getStore()?.beforeSend?.()});return timeNotification('http',()=>value.apply(target,args))};
 }});
}
export class TelegramRateDeferredError extends Error{
 readonly code='TELEGRAM_RATE_DEFERRED';
 constructor(readonly retryAt:Date){super('Telegram delivery is waiting for the shared rate budget')}
}
type Cooldown={retryAt:Date;waitUntil:number};
const knownCooldowns=new WeakMap<PrismaClient,Map<string,Cooldown>>();
const localTransportStarts=new WeakMap<PrismaClient,Map<string,number[]>>();

export function canonicalTelegramChatId(chatId:string|number){
 const value=String(chatId);
 if(/^-?\d{1,20}$/.test(value))return BigInt(value).toString();
 if(/^@[A-Za-z0-9_]{5,32}$/.test(value))return value.toLowerCase();
 throw Error('Invalid Telegram delivery chat');
}

const rateInterval=(rate:number)=>rate===30?33:Math.ceil(1000/rate);
function reservationFor(botId:string,chatId:string,priority:TelegramSendPriority,settings:NotificationSettings):TelegramSendReservation{
 const group=chatId.startsWith('-')||chatId.startsWith('@');
 return {botId,chatId,priority,globalMs:rateInterval(settings.TELEGRAM_SENDS_PER_SECOND),bulkMs:rateInterval(settings.TELEGRAM_BULK_SENDS_PER_SECOND),
  chatMs:group?settings.TELEGRAM_GROUP_CHAT_INTERVAL_MS:settings.TELEGRAM_PRIVATE_CHAT_INTERVAL_MS};
}

/** Claims only an immediately usable slot, never reserves a future backlog.
 * Fixed bot→chat lock order prevents deadlocks. No HTTP or sleep owns a lock.
 * UTC database time, rather than a worker's clock, orders every process.
 */
export async function reserveTelegramSend(client:PrismaClient,botId:string,chat:string|number,priority:TelegramSendPriority='high',settings:NotificationSettings=notificationSettings()):Promise<TelegramSendGrant>{
 if(!/^\d+$/.test(botId))throw Error('Invalid Telegram bot identity');
 const {chatId,globalMs,bulkMs,chatMs}=reservationFor(botId,canonicalTelegramChatId(chat),priority,settings);
 const newCapacity=(globalMs<35||bulkMs<=globalMs)&&await notificationSendCapacityReady(client);
 const legacyGlobal=Math.max(35,globalMs),legacyBulk=Math.max(36,legacyGlobal+1,bulkMs);
 const [grant]=newCapacity?await client.$queryRaw<TelegramSendGrant[]>`SELECT * FROM public.lowwin_reserve_telegram_send(
  ${botId},${chatId},${priority},${globalMs}::integer,${bulkMs}::integer,${chatMs}::integer)`:
  await client.$queryRaw<TelegramSendGrant[]>`SELECT * FROM public.reserve_telegram_send(
  ${botId},${chatId},${priority},${legacyGlobal}::integer,${legacyBulk}::integer,${chatMs}::integer)`;
 if(!grant)throw Error('Telegram rate reservation unavailable');
 return grant;
}

/** A 429 applies to all senders for this bot, including command/payment workers. */
export async function recordTelegramCooldown(client:PrismaClient,botId:string,retryAfter:unknown){
 const supplied=Number(retryAfter),seconds=Number.isSafeInteger(supplied)&&supplied>0?Math.min(supplied,2147483647):60;
 const waitUntil=performance.now()+seconds*1000;
 let cooldowns=knownCooldowns.get(client);
 if(!cooldowns){cooldowns=new Map();knownCooldowns.set(client,cooldowns)}
 const previous=cooldowns.get(botId);
 const local={retryAt:new Date(Date.now()+seconds*1000),waitUntil};
 if(!previous||previous.waitUntil<waitUntil)cooldowns.set(botId,local);
 const [row]=await client.$queryRaw<{retryAt:Date;now:Date}[]>`
  INSERT INTO "TelegramRateBudget" ("botId","nextSendAt","nextBulkAt","highStreak","cooldownUntil")
   VALUES (${botId},clock_timestamp() AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC',0,(clock_timestamp() AT TIME ZONE 'UTC')+${seconds}*interval '1 second')
  ON CONFLICT ("botId") DO UPDATE SET "cooldownUntil"=GREATEST("TelegramRateBudget"."cooldownUntil",EXCLUDED."cooldownUntil")
  RETURNING "cooldownUntil" AS "retryAt",clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 const durableWaitUntil=row.now?performance.now()+Math.max(0,row.retryAt.getTime()-row.now.getTime()):waitUntil;
 const saved=cooldowns.get(botId);
 if(!saved||saved===local||saved.waitUntil<durableWaitUntil)cooldowns.set(botId,{retryAt:row.retryAt,waitUntil:Math.max(waitUntil,durableWaitUntil)});
 return row.retryAt;
}

function activeCooldown(client:PrismaClient,botId:string){
 const saved=knownCooldowns.get(client)?.get(botId);
 if(!saved)return null;
 const waitMs=Math.ceil(saved.waitUntil-performance.now());
 return waitMs>0?{granted:false as const,waitMs,retryAt:saved.retryAt}:null;
}

function assertNoCooldown(client:PrismaClient,botId:string){
 const cooldown=activeCooldown(client,botId);
 if(cooldown)throw new TelegramRateDeferredError(cooldown.retryAt);
}

/** Database grants are shared. Network jitter can still bunch local starts. */
function checkTransportWindow(client:PrismaClient,botId:string){
 const now=performance.now();
 let bots=localTransportStarts.get(client);
 if(!bots){bots=new Map();localTransportStarts.set(client,bots)}
 let starts=bots.get(botId);
 if(!starts){starts=[];bots.set(botId,starts)}
 let expired=0;
 while(expired<starts.length&&starts[expired]<=now-1000)expired++;
 if(expired)starts.splice(0,expired);
 if(starts.length>=30){
  const waitMs=Math.max(1,Math.ceil(starts[0]+1000-now));
  throw new TelegramRateDeferredError(new Date(Date.now()+waitMs));
 }
 starts.push(now);
}

// Grammy's installed Node transport uses abort-controller's older signal.
// Bridge its event to a native controller instead of casting incompatible types.
async function waitForRate(ms:number,signal:Parameters<Transformer>[3]){
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort);
 try{if(signal?.aborted)abort();await delay(ms,undefined,{signal:controller.signal})}
 finally{signal?.removeEventListener('abort',abort)}
}

const meteredMethods=new Set(['sendMessage','sendPhoto','sendDocument','sendVideo','sendAnimation','sendAudio','sendVoice','sendSticker','sendLocation','sendContact','sendVenue','sendPoll','sendDice','forwardMessage','copyMessage','editMessageText','editMessageCaption','editMessageMedia','editMessageReplyMarkup','deleteMessage']);

export function telegramRateTransformer(client:PrismaClient,botId:string,settings:NotificationSettings=notificationSettings()):Transformer{
 let nextBulkReservation=0;
 return async(prev,method,payload,signal)=>{
  const fields=payload as Record<string,unknown>;
  if(fields.allow_paid_broadcast===true)throw Error('Paid Telegram broadcasting is disabled');
  if(!meteredMethods.has(method)||fields.chat_id===undefined)return prev(method,payload,signal);
  const chatId=canonicalTelegramChatId(String(fields.chat_id)),policy=policies.getStore(),started=performance.now();
  const priority=policy?.priority??'high',reservation=reservationFor(botId,chatId,priority,settings);
  let gated=false;
  try{while(true){
   if(signal?.aborted)throw Error('Telegram delivery aborted');
   // A provider-imposed cooldown known to this process can deny requests.
   // Only a fresh PostgreSQL reservation can grant one across workers.
   let cooldown=activeCooldown(client,botId);
   // Stagger full-rate outbox requests so replies do not have all lanes compete
   // for the same slot. PostgreSQL still grants every send.
   if(!cooldown&&priority==='bulk'&&policy?.reserveBeforeSend&&settings.TELEGRAM_BULK_SENDS_PER_SECOND===30){
    const now=performance.now(),scheduled=Math.max(nextBulkReservation,now);
    const waitMs=Math.ceil(scheduled-now),remaining=settings.TELEGRAM_RATE_MAX_WAIT_MS-(now-started);
    if(waitMs>remaining)throw new TelegramRateDeferredError(new Date(Date.now()+waitMs));
    nextBulkReservation=scheduled+1000/30;
    if(waitMs>0)await waitForRate(waitMs,signal);
    cooldown=activeCooldown(client,botId);
   }
   const fused=cooldown?null:await policy?.reserveBeforeSend?.(reservation);
   const grant=cooldown??fused??await reserveTelegramSend(client,botId,chatId,priority,settings);
   if(grant.granted){gated=!!fused;break}
   const remaining=settings.TELEGRAM_RATE_MAX_WAIT_MS-(performance.now()-started);
   if(grant.waitMs>remaining||remaining<=0)throw new TelegramRateDeferredError(grant.retryAt);
   await waitForRate(Math.min(remaining,grant.waitMs+Math.floor(Math.random()*6)),signal);
  }}finally{recordNotificationTiming('rate',performance.now()-started)}
  // Quota polling performs no HTTP. Recheck durable ownership/Stop once after
  // waiting, immediately before transport, rather than on every denied slot.
  assertNoCooldown(client,botId);
  if(!gated)await timeNotification('gate',async()=>{await policy?.beforeSend?.()});
  assertNoCooldown(client,botId);
  if(signal?.aborted)throw Error('Telegram delivery aborted');
  checkTransportWindow(client,botId);
  try{
   const response=await timeNotification('http',()=>prev(method,payload,signal));
   if(!response.ok&&response.error_code===429)await recordTelegramCooldown(client,botId,response.parameters?.retry_after);
   return response;
  }catch(error){
   const failure=error as {error_code?:number;parameters?:{retry_after?:number}};
   if(failure.error_code===429)await recordTelegramCooldown(client,botId,failure.parameters?.retry_after);
   throw error;
  }
 };
}

/** Install once on every production API instance. Tests may install it around
 * a simulated inner transformer; the same shared database budget still applies.
 */
export function installTelegramRateLimit(api:Pick<Api,'config'>,client:PrismaClient,token:string){
 if(installed.has(api))return;
 const botId=token.split(':')[0];
 if(!/^\d+$/.test(botId))throw Error('Invalid Telegram bot identity');
 api.config.use(telegramRateTransformer(client,botId));installed.add(api);
}
