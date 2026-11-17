import {Prisma,type PrismaClient,type Outbox} from '@prisma/client';
import type {Bot} from 'grammy';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {safeResultIdentity} from '../auctions/result-identity';
import {auctionMaintenance} from '../auctions/maintenance';
import {notificationContent,materializeAlert,notificationPhoto,telegramCampaignText} from './service';
import {broadcastRoot,expandCampaign,telegramKinds} from './campaigns';
import {expandParticipantResults} from './participant-results';
import {expandBroadcastDeletion,telegramMessageDeletable} from './broadcast-delete';
import {promotionNow} from './auction-promotion';
import {chapaReceiptKind} from './chapa-receipt';
import {hasResultSubscription} from './result-audience';
import {auctionPhoto} from './auction-photo';
import {sendBroadcastPhoto,TelegramMediaDeferredError} from './broadcast-photo';
import {claimNotifications,claimExpansion,claimLogicalDelivery,finishClaim,highPriorityKinds,type ClaimedNotification} from './leases';
import {withTelegramSendPolicy,telegramPolicyApi,TelegramRateDeferredError} from './telegram-rate';
import {beforeNotificationSend,DeliveryGate,type RecipientGate} from './send-gate';
import {recordNotificationTiming,recordNotificationAccepted,recordNotificationUncertain,timeNotification} from './diagnostics';

import {notificationRetired} from './policy';
type BotApi=Pick<Bot,'api'>;
type Content=Awaited<ReturnType<typeof notificationContent>>;
type BatchContext={content:Map<string,Promise<Content>>;shouldContinue:()=>boolean};
const campaignContentByClient=new WeakMap<PrismaClient,Map<string,{until:number;value:Promise<Content>}>>();
const notificationImage=resolve('public/notification.png');
const botId=()=>process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]??'';
const beforeSend=(client:PrismaClient,row:ClaimedNotification,context:BatchContext,logicalKey?:string,recipient?:RecipientGate)=>beforeNotificationSend(client,row,context.shouldContinue,logicalKey,recipient);

async function getContent(client:PrismaClient,row:ClaimedNotification,context:BatchContext){
 if(!telegramKinds.includes(row.kind)||highPriorityKinds.includes(row.kind))return notificationContent(client,row);
 const p=row.payload as Record<string,unknown>,{recipientUserId,...shared}=p;
 const key=row.kind+':'+JSON.stringify(shared);
 let promise=context.content.get(key);
 if(!promise){
  let cache=campaignContentByClient.get(client);if(!cache){cache=new Map();campaignContentByClient.set(client,cache)}
  const saved=cache.get(key);
  if(saved&&saved.until>performance.now())promise=saved.value;
  else{
   promise=notificationContent(client,row);
   if(cache.size>=64)cache.delete(cache.keys().next().value!);
   const entry={until:performance.now()+(row.kind==='BROADCAST'?60_000:1000),value:promise};cache.set(key,entry);
   // Never retain failed/missing preparation. Every actual send still reads
   // ownership, recipient and auction eligibility at the durable gate.
   promise.then(value=>{if(!value&&cache.get(key)===entry)cache.delete(key)},()=>{if(cache.get(key)===entry)cache.delete(key)});
  }
  context.content.set(key,promise);
 }
 const value=await promise;
 return value&&typeof recipientUserId==='string'?{...value,userId:recipientUserId}:value;
}

async function fail(client:PrismaClient,row:ClaimedNotification,error:unknown,chatTelegramId?:string){
 if(error instanceof DeliveryGate){
  await finishClaim(client,row,{state:error.retry?'PENDING':'SKIPPED',lastError:error.reason,nextAttemptAt:new Date(Date.now()+1000)});return;
 }
 if(error instanceof TelegramRateDeferredError||error instanceof TelegramMediaDeferredError){
  await finishClaim(client,row,{state:'PENDING',lastError:error instanceof TelegramRateDeferredError?'RATE_BUDGET_WAIT':'MEDIA_UPLOAD_WAIT',nextAttemptAt:error.retryAt});return;
 }
 const e=error as {error_code?:number;parameters?:{retry_after?:number}},attempts=row.attempts+1;
 if(e.error_code===403&&chatTelegramId)await client.botChat.updateMany({where:{telegramId:chatTelegramId},data:{blocked:true}});
 const terminal=e.error_code===403||e.error_code===400||attempts>=8;
 const supplied=Number(e.parameters?.retry_after),retry=e.error_code===429?(Number.isSafeInteger(supplied)&&supplied>0?Math.min(supplied,2_147_483_647):60):Math.min(3600,2**attempts*5)*(1+Math.random()*.2);
 const nextAttemptAt=new Date(Math.min(8_640_000_000_000_000,Date.now()+retry*1000));
 await finishClaim(client,row,{attempts,state:terminal?'FAILED':'PENDING',lastError:e.error_code===429?'RATE_LIMIT':e.error_code===403?'CHAT_BLOCKED':e.error_code===400?'BAD_REQUEST':'DELIVERY_RETRY',nextAttemptAt});
}

async function dispatchClaim(client:PrismaClient,bot:BotApi,row:ClaimedNotification,context:BatchContext){
 const skip=(lastError:string|null=null)=>finishClaim(client,row,{state:'SKIPPED',lastError});
 const preparingAt=performance.now();
 let recipientTelegramId:string|undefined;
 let acceptedByTelegram=false;
 try{
  if(notificationRetired(row.kind)){await skip('NOTIFICATION_RETIRED');return}
  if(row.kind==='TELEGRAM_DELETE'){
   const p=row.payload as {telegramMessageId?:string},record=p.telegramMessageId?await client.telegramMessage.findUnique({where:{id:p.telegramMessageId}}):null;
   if(!record||!['QUEUED','FAILED'].includes(record.deletionState)){await skip();return}
   try{
    await withTelegramSendPolicy({priority:'bulk',beforeSend:async()=>{
     await beforeSend(client,row,context);
     if(!telegramMessageDeletable(record.sentAt,await promotionNow(client))||!Number.isSafeInteger(Number(record.messageId))||record.messageId<=0n)throw new DeliveryGate('TELEGRAM_DELETE_WINDOW_EXPIRED',false);
    }},()=>bot.api.deleteMessage(record.chatId,Number(record.messageId)));
    await client.$transaction(async tx=>{const changed=await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{state:'SENT',sentAt:new Date(),attempts:{increment:1},lastError:null,leaseToken:null,leaseUntil:null}});if(changed.count)await tx.telegramMessage.update({where:{id:record.id},data:{deletionState:'DELETED',deletionAttemptedAt:new Date(),deletionError:null}})});
   }catch(error){
    if(error instanceof DeliveryGate&&error.reason==='TELEGRAM_DELETE_WINDOW_EXPIRED'){
     await client.$transaction(async tx=>{const changed=await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{state:'SKIPPED',lastError:error.reason,leaseToken:null,leaseUntil:null}});if(changed.count)await tx.telegramMessage.update({where:{id:record.id},data:{deletionState:'UNAVAILABLE',deletionAttemptedAt:new Date(),deletionError:error.reason}})});return;
    }
    if(error instanceof DeliveryGate||error instanceof TelegramRateDeferredError){await fail(client,row,error);return}
    const failure=error as {error_code?:number;parameters?:{retry_after?:number}},code=failure.error_code,terminal=code===400||code===403||row.attempts>=7;
    const supplied=Number(failure.parameters?.retry_after),seconds=code===429?(Number.isSafeInteger(supplied)&&supplied>0?Math.min(supplied,2147483647):60):Math.min(3600,2**(row.attempts+1)*5);
    await client.$transaction(async tx=>{const changed=await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{state:terminal?'FAILED':'PENDING',attempts:{increment:1},lastError:code===429?'RATE_LIMIT':'TELEGRAM_DELETE_FAILED',nextAttemptAt:new Date(Date.now()+seconds*1000),leaseToken:null,leaseUntil:null}});if(changed.count)await tx.telegramMessage.update({where:{id:record.id},data:{deletionState:code===400||code===403?'UNAVAILABLE':'FAILED',deletionAttemptedAt:new Date(),deletionError:code===400?'DELETE_WINDOW_OR_MESSAGE_UNAVAILABLE':code===403?'CHAT_BLOCKED':terminal?'DELETE_RETRY_EXHAUSTED':'DELETE_RETRY'}})});
   }
   return;
  }
  const content=await getContent(client,row,context);
  if(!content){await skip();return}
  if(row.kind!=='AUCTION_ENDED')await materializeAlert(client,row,content);
  if(row.testRunId||!telegramKinds.includes(row.kind)&&!highPriorityKinds.includes(row.kind)&&row.kind!==chapaReceiptKind){await skip();return}
  const merchantAlert='merchantAlert' in content&&content.merchantAlert===true;
  const users=merchantAlert?[]:await client.$queryRaw<{telegramId:string;name:string;chatId:string|null;blocked:boolean|null}[]>`SELECT u."telegramId",u.name,c."chatId",c.blocked FROM "user" u LEFT JOIN "BotChat" c ON c."telegramId"=u."telegramId" WHERE u.id=${content.userId} LIMIT 1`;
  const user=users[0],recipient=merchantAlert&&'recipientTelegramId' in content&&typeof content.recipientTelegramId==='string'?content.recipientTelegramId:user?.telegramId;
  const chat=merchantAlert&&recipient?await client.botChat.findUnique({where:{telegramId:recipient}}):user?.chatId?{telegramId:user.telegramId,chatId:user.chatId,blocked:user.blocked}:null;
  if(!chat||chat.blocked){await skip(row.kind==='BROADCAST'?(chat?'CHAT_BLOCKED':'CHAT_NOT_STARTED'):null);return}
  recipientTelegramId=chat.telegramId;
  if((merchantAlert||row.kind==='AUCTION_ENDED'||highPriorityKinds.includes(row.kind))&&chat.chatId!==recipient){await skip('PRIVATE_CHAT_REQUIRED');return}
  let logicalKey:string|undefined;
  const payload=row.payload as {auctionId?:string;recipientUserId?:string};
  if(row.kind==='AUCTION_ENDED'){
   if(!await hasResultSubscription(client,content.userId)){await skip('RESULT_RECIPIENT_INELIGIBLE');return}
   if(!payload.auctionId){await skip('RESULT_NOT_PUBLISHED');return}
   const delivered=await client.telegramMessage.findFirst({where:{auctionId:payload.auctionId,chatId:chat.chatId,outbox:{is:{kind:{in:['AUCTION_ENDED','AUCTION_RESULT']}}}},select:{id:true}});
   if(delivered){await finishClaim(client,row,{state:'SENT',sentAt:new Date(),lastError:'RESULT_ALREADY_DELIVERED'});return}
   const logical=await claimLogicalDelivery(client,row,botId(),payload.auctionId,content.userId);logicalKey=logical.key;
   if(logical.sent){await finishClaim(client,row,{state:'SENT',sentAt:new Date(),lastError:'RESULT_ALREADY_DELIVERED'});return}
   if(!logical.acquired){await finishClaim(client,row,{state:'PENDING',nextAttemptAt:new Date(Date.now()+1000),lastError:'DELIVERY_LEASE_WAIT'});return}
   await materializeAlert(client,row,content);
  }
  const link=new URL(content.href,process.env.MINI_APP_URL);
  if(link.protocol!=='https:'){await skip();return}
  const name=safeResultIdentity(user).displayName??'ተጫዋች',startReminder=['AUCTION_UPCOMING','AUCTION_UPCOMING_1_HOUR'].includes(row.kind),paymentReceipt=row.kind===chapaReceiptKind||row.kind==='AUCTION_FEE_REFUNDED';
  const body=content.body.includes('{name}')?content.body.replaceAll('{name}',name):`${name},\n${content.body}`;
  const text=paymentReceipt?content.body:row.kind==='BROADCAST'?content.body.replaceAll('{name}',name):'telegramCaption' in content&&typeof content.telegramCaption==='string'?content.telegramCaption.replaceAll('{name}',name):telegramCampaignText(row.kind,content.title,startReminder?content.body:body,startReminder?name:undefined);
  const button='buttonLabel' in content?String(content.buttonLabel):row.kind==='DEPOSIT_CREDITED'?'ዋሌቴን ልይ':row.kind==='BID_ACCEPTED'?'ጨረታዎቼን ልይ':row.kind==='WINNER_CONGRATULATIONS'?'ሽልማቴን ልይ':row.kind==='AUCTION_ENDED'?'ውጤቱን ልይ':'ጨረታውን ልይ';
  const options={reply_markup:{inline_keyboard:[[merchantAlert?{text:button,url:link.href}:{text:button,web_app:{url:link.href}}]]}};
  const auctionImage=(row.kind.startsWith('AUCTION_')||row.kind==='BROADCAST'||row.kind==='BID_ACCEPTED'||row.kind==='WINNER_CONGRATULATIONS')&&'imagePath' in content&&typeof content.imagePath==='string'?content.imagePath:null;
  const imageId='imageId' in content&&typeof content.imageId==='string'?content.imageId:undefined;
  const local=auctionImage&&!auctionImage.startsWith('/api/')?resolve('public','.'+auctionImage):notificationImage;
  const version=existsSync(local)?`${statSync(local).mtimeMs}:${statSync(local).size}`:'immutable-media';
  const photoKey=auctionImage?`auction:${auctionImage}:${version}`:`notification:${imageId??'default'}:${version}`;
  const preparePhoto=async()=>{
   if(paymentReceipt||row.kind==='DEPOSIT_CREDITED')return null;
   let photo=(row.kind.startsWith('AUCTION_')||auctionImage)?(auctionImage?await auctionPhoto(client,auctionImage):null):await notificationPhoto(client,imageId,link.origin);
   if(!photo&&row.kind==='AUCTION_ENDED'&&'fallbackImagePath' in content&&typeof content.fallbackImagePath==='string')photo=await auctionPhoto(client,content.fallbackImagePath);
   if(!photo&&row.kind==='BROADCAST'&&(auctionImage||imageId))throw Error('Original broadcast media is unavailable');
   return photo;
  };
  const gate:RecipientGate={telegramId:chat.telegramId,chatId:chat.chatId,userId:content.userId,excludeStaff:row.kind==='BROADCAST'||row.kind.startsWith('AUCTION_')};
  recordNotificationTiming('preparation',performance.now()-preparingAt);
  const sent=await withTelegramSendPolicy({priority:highPriorityKinds.includes(row.kind)?'high':'bulk',beforeSend:()=>beforeSend(client,row,context,logicalKey,gate)},async()=>{
   const photo=paymentReceipt||row.kind==='DEPOSIT_CREDITED'?null:await sendBroadcastPhoto(bot.api,chat.chatId,()=>timeNotification('mediaPreparation',preparePhoto),{...options,caption:text},photoKey,{client,botId:botId()});
   return photo??bot.api.sendMessage(chat.chatId,text,options);
  });
  acceptedByTelegram=true;recordNotificationAccepted();
  await timeNotification('acknowledgement',()=>finishClaim(client,row,{state:'SENT',sentAt:new Date(),attempts:{increment:1},lastError:null},{chatId:chat.chatId,messageId:sent.message_id,auctionId:payload.auctionId,logicalKey}));
 }catch(error){
  if(acceptedByTelegram){
   recordNotificationUncertain();
   // Telegram has no idempotent send API. A failed acknowledgement must retain
   // its lease rather than immediately resend an already accepted message.
   await client.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{lastError:'ACKNOWLEDGEMENT_UNCERTAIN',nextAttemptAt:row.leaseUntil}}).catch(()=>{});
   console.warn('notification_acknowledgement_uncertain',{kind:row.kind});return;
  }
  await fail(client,row,error,recipientTelegramId);
 }
}

export async function dispatchBatch(client:PrismaClient,bot:BotApi,options:{limit?:number;concurrency?:number;priority?:'high'|'bulk';shouldContinue?:()=>boolean;kind?:string}={}){
 const shouldContinue=options.shouldContinue??(()=>true);if(!shouldContinue())return 0;
 const rows=await timeNotification('claim',()=>claimNotifications(client,options)),context:BatchContext={content:new Map(),shouldContinue};
 bot={api:telegramPolicyApi(bot.api)};
 let index=0;const lanes=Math.max(1,Math.min(8,Math.floor(options.concurrency??4),rows.length));
 await Promise.all(Array.from({length:lanes},async()=>{for(;;){const row=rows[index++];if(!row)return;await dispatchClaim(client,bot,row,context)}}));
 return rows.length;
}

export async function expandPendingCampaigns(client:PrismaClient,{limit=4}:{limit?:number}={}){
 let processed=0;
 for(let i=0;i<Math.max(1,Math.min(16,limit));i++){
  const row=await claimExpansion(client);if(!row)break;
  try{
   await client.$transaction(async tx=>{
    if(await auctionMaintenance(tx))throw new DeliveryGate('MAINTENANCE_PAUSED',true);
    const root=broadcastRoot(row);
    if(root){const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`broadcast:${root}`},0)) AS locked`;if(!locked)throw new DeliveryGate('CAMPAIGN_LOCK_WAIT',true)}
    const rows=await tx.$queryRaw<Outbox[]>`SELECT * FROM "Outbox" WHERE id=${row.id} AND state='PENDING' AND "leaseToken"=${row.leaseToken} FOR UPDATE`;
    if(!rows.length)return;
    if(row.kind==='BROADCAST_DELETE')await expandBroadcastDeletion(tx,row);else if(row.kind==='AUCTION_PARTICIPANTS')await expandParticipantResults(tx,row);else await expandCampaign(tx,row);
    await tx.outbox.updateMany({where:{id:row.id,leaseToken:row.leaseToken},data:{leaseToken:null,leaseUntil:null}});
   },{timeout:10000,maxWait:5000});
  }catch(error){await fail(client,row,error)}
  processed++;
 }
 return processed;
}

/** Compatibility for one-off callers/tests. Production uses independent lanes. */
export async function dispatchOne(client:PrismaClient,bot:BotApi,filter?:{kind:typeof chapaReceiptKind}){
 if(filter&&filter.kind!==chapaReceiptKind)throw Error('Unsupported notification dispatch filter');
 if(!filter&&await expandPendingCampaigns(client,{limit:1}))return true;
 return !!await dispatchBatch(client,bot,{limit:1,concurrency:1,...filter});
}
