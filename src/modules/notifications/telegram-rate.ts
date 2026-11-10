import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import type {PrismaClient} from '@prisma/client';
import type {Api,Transformer} from 'grammy';
import {notificationSettings,type NotificationSettings} from './settings';
import {recordNotificationTiming,timeNotification} from './diagnostics';

export type TelegramSendPriority='high'|'bulk';
type SendPolicy={priority?:TelegramSendPriority;beforeSend?:()=>Promise<void>|void};
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
type Grant={granted:boolean;waitMs:number;retryAt:Date};

export function canonicalTelegramChatId(chatId:string|number){
 const value=String(chatId);
 if(/^-?\d{1,20}$/.test(value))return BigInt(value).toString();
 if(/^@[A-Za-z0-9_]{5,32}$/.test(value))return value.toLowerCase();
 throw Error('Invalid Telegram delivery chat');
}

/** Claims only an immediately usable slot, never reserves a future backlog.
 * Fixed bot→chat lock order prevents deadlocks. No HTTP or sleep owns a lock.
 * UTC database time, rather than a worker's clock, orders every process.
 */
export async function reserveTelegramSend(client:PrismaClient,botId:string,chat:string|number,priority:TelegramSendPriority='high',settings:NotificationSettings=notificationSettings()):Promise<Grant>{
 if(!/^\d+$/.test(botId))throw Error('Invalid Telegram bot identity');
 const chatId=canonicalTelegramChatId(chat),group=chatId.startsWith('-')||chatId.startsWith('@');
 const [grant]=await client.$queryRaw<Grant[]>`SELECT * FROM public.reserve_telegram_send(
  ${botId},${chatId},${priority},${Math.ceil(1000/settings.TELEGRAM_SENDS_PER_SECOND)}::integer,
  ${Math.ceil(1000/settings.TELEGRAM_BULK_SENDS_PER_SECOND)}::integer,
  ${group?settings.TELEGRAM_GROUP_CHAT_INTERVAL_MS:settings.TELEGRAM_PRIVATE_CHAT_INTERVAL_MS}::integer)`;
 if(!grant)throw Error('Telegram rate reservation unavailable');
 return grant;
}

/** A 429 applies to all senders for this bot, including command/payment workers. */
export async function recordTelegramCooldown(client:PrismaClient,botId:string,retryAfter:unknown){
 const supplied=Number(retryAfter),seconds=Number.isSafeInteger(supplied)&&supplied>0?Math.min(supplied,2147483647):60;
 const [row]=await client.$queryRaw<{retryAt:Date}[]>`
  INSERT INTO "TelegramRateBudget" ("botId","nextSendAt","nextBulkAt","highStreak","cooldownUntil")
   VALUES (${botId},clock_timestamp() AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC',0,(clock_timestamp() AT TIME ZONE 'UTC')+${seconds}*interval '1 second')
  ON CONFLICT ("botId") DO UPDATE SET "cooldownUntil"=GREATEST("TelegramRateBudget"."cooldownUntil",EXCLUDED."cooldownUntil")
  RETURNING "cooldownUntil" AS "retryAt"`;
 return row.retryAt;
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
 return async(prev,method,payload,signal)=>{
  const fields=payload as Record<string,unknown>;
  if(fields.allow_paid_broadcast===true)throw Error('Paid Telegram broadcasting is disabled');
  if(!meteredMethods.has(method)||fields.chat_id===undefined)return prev(method,payload,signal);
  const chatId=canonicalTelegramChatId(String(fields.chat_id)),policy=policies.getStore(),started=performance.now();
  try{while(true){
   if(signal?.aborted)throw Error('Telegram delivery aborted');
   const grant=await reserveTelegramSend(client,botId,chatId,policy?.priority??'high',settings);
   if(grant.granted)break;
   const remaining=settings.TELEGRAM_RATE_MAX_WAIT_MS-(performance.now()-started);
   if(grant.waitMs>remaining||remaining<=0)throw new TelegramRateDeferredError(grant.retryAt);
   await waitForRate(Math.min(250,grant.waitMs+Math.floor(Math.random()*6)),signal);
  }}finally{recordNotificationTiming('rate',performance.now()-started)}
  // Quota polling performs no HTTP. Recheck durable ownership/Stop once after
  // waiting, immediately before transport, rather than on every denied slot.
  await timeNotification('gate',async()=>{await policy?.beforeSend?.()});
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
