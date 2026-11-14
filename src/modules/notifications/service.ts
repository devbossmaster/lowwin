import {campaignContent,scheduleGlobalAlerts,telegramKinds} from './campaigns';
import type {Prisma,Outbox} from '@prisma/client';
import {InputFile} from 'grammy';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {notificationRetired,endingReminders,upcomingReminders} from './policy';
import {privateNotificationContent} from './private-content';
type DB=Prisma.TransactionClient;
const notificationImage=resolve('public/notification.png');
const composedPhotos=new Map<string,Promise<Buffer|null>>();

export function telegramCampaignText(kind:string,title:string,body:string,name?:string){
 if(kind==='BROADCAST')return body;
 const greeting=name?`ሰላም ${name}፣\n\n`:'';
 return `${greeting}${title}\n\n${body}`;
}

export async function notificationPhoto(tx:DB,imageId:string|undefined,origin:string,imagePath=notificationImage){
 const custom=imageId?new URL(`/api/media/${imageId}`,origin).href:null;
 if(!existsSync(imagePath))return custom;
 if(!imageId)return new InputFile(imagePath);
 const cacheKey=`${imagePath}:${imageId}:${statSync(imagePath).mtimeMs}`;
 let pending=composedPhotos.get(cacheKey);
 if(!pending){
  pending=(async()=>{
  const media=await tx.managedMedia.findUnique({where:{id:imageId},select:{bytes:true}});
  if(!media)return null;
  const base=await sharp(Buffer.from(media.bytes)).resize(900,900,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const {width=900,height=900}=await sharp(base).metadata();
  const badge=await sharp(imagePath).resize({width:Math.max(72,Math.round(width*0.2)),height:Math.max(72,Math.round(height*0.2)),fit:'inside'}).png().toBuffer();
  const size=await sharp(badge).metadata();
  return sharp(base).composite([{input:badge,left:Math.max(0,width-(size.width??0)-12),top:Math.max(0,height-(size.height??0)-12)}]).png().toBuffer();
  })();
  if(composedPhotos.size>=10)composedPhotos.clear();
  composedPhotos.set(cacheKey,pending);
 }
 let photo:Buffer|null;try{photo=await pending}catch(error){composedPhotos.delete(cacheKey);throw error}
 if(!photo){composedPhotos.delete(cacheKey);return new InputFile(imagePath)}
 return new InputFile(photo,'notification.png');
}
export async function notificationContent(tx:DB,row:Pick<Outbox,'kind'|'payload'>&Partial<Pick<Outbox,'key'>>){
 if(notificationRetired(row.kind))return null;
 if(['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS'].includes(row.kind))return privateNotificationContent(tx,row);
 return telegramKinds.includes(row.kind)?campaignContent(tx,row):null;
}
export async function materializeAlert(tx:DB,row:Pick<Outbox,'key'|'kind'|'payload'>&Partial<Pick<Outbox,'testRunId'>>,prepared?:Awaited<ReturnType<typeof notificationContent>>){
 // Manual broadcasts remain Telegram-only. Retired rows stay as durable history.
 if(notificationRetired(row.kind)||row.kind==='BROADCAST')return;
 const content=prepared===undefined?await notificationContent(tx,row):prepared;if(!content)return;
 const preference=await tx.notificationPreference.findUnique({where:{userId:content.userId},select:{inApp:true}});
 if(preference?.inApp===false)return;

 await tx.notificationInbox.upsert({where:{key:row.key},create:{key:row.key,userId:content.userId,kind:content.kind,title:content.title,body:content.body,href:content.href,testRunId:row.testRunId},update:{}});
}
export async function enqueueAlert(tx:DB,input:{key:string;kind:string;auctionId:string;userId:string;bidId?:string;batchId?:string}){
 const auction=await tx.auction.findUnique({where:{id:input.auctionId},select:{testRunId:true}});
 const row=await tx.outbox.create({data:{key:input.key,kind:input.kind,payload:{auctionId:input.auctionId,recipientUserId:input.userId,...(input.bidId?{bidId:input.bidId}:{}),...(input.batchId?{batchId:input.batchId}:{})},testRunId:auction?.testRunId}});
 await materializeAlert(tx,row);return row;
}
export const scheduleAlerts=scheduleGlobalAlerts;
export {dispatchOne,dispatchBatch,expandPendingCampaigns} from './dispatch';

export async function retireAuctionPromotions(tx:DB,auctionId:string,now:Date){
 const promotional=['AUCTION_PUBLISHED','AUCTION_UPCOMING_ADDED',...upcomingReminders.map(r=>r.kind),...endingReminders.map(r=>r.kind),'GLOBAL_CAMPAIGN'];
 const jobs=await tx.outbox.findMany({where:{kind:{in:promotional},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,state:true}});
 if(jobs.length)await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(job=>job.key)}}});
 const pending=jobs.filter(job=>job.state==='PENDING');
 const stopped=pending.length?await tx.outbox.updateMany({where:{id:{in:pending.map(job=>job.id)},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:'AUCTION_RETIRED',leaseToken:null,leaseUntil:null}}):{count:0};
 const messages=await tx.telegramMessage.findMany({where:{auctionId,deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){
  if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}
  await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});
  await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++;
 }
 return {pendingSkipped:stopped.count,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}

export async function retireAuctionEndingAlerts(tx:DB,auctionId:string,now:Date){
 const candidates=await tx.outbox.findMany({where:{kind:{in:['GLOBAL_CAMPAIGN',...endingReminders.map(r=>r.kind)]},payload:{path:['auctionId'],equals:auctionId}},select:{id:true,key:true,kind:true,state:true,payload:true}});
 const jobs=candidates.filter(row=>endingReminders.some(r=>r.kind===row.kind||r.kind===(row.payload as {deliveryKind?:string}).deliveryKind));if(!jobs.length)return {endingAlertsRetired:0,telegramDeletesQueued:0,telegramDeletesUnavailable:0};
 await tx.notificationInbox.deleteMany({where:{key:{in:jobs.map(row=>row.key)}}});const pending=jobs.filter(row=>row.state==='PENDING');if(pending.length)await tx.outbox.updateMany({where:{id:{in:pending.map(row=>row.id)},OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:'SUPERSEDED_BY_DEADLINE_CHANGE',leaseToken:null,leaseUntil:null}});
 const messages=await tx.telegramMessage.findMany({where:{outboxId:{in:jobs.map(row=>row.id)},deletionState:'DELIVERED'}});let queued=0,unavailable=0;
 for(const message of messages){if(now.getTime()-message.sentAt.getTime()>=47*3600000){await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});unavailable++;continue}await tx.outbox.create({data:{key:`telegram-delete:${message.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:message.id},testRunId:message.testRunId}});await tx.telegramMessage.update({where:{id:message.id},data:{deletionState:'QUEUED',deletionRequestedAt:now}});queued++}
 return {endingAlertsRetired:jobs.length,telegramDeletesQueued:queued,telegramDeletesUnavailable:unavailable};
}
