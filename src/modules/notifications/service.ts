import {campaignContent,scheduleGlobalAlerts,telegramKinds} from './campaigns';
import {Prisma,type Outbox} from '@prisma/client';
import {InputFile} from 'grammy';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {notificationRetired,endingReminders,retiredPreStartReminderKinds,upcomingReminder} from './policy';
import {privateNotificationContent} from './private-content';
import {telegramPhotoFrame} from './telegram-photo-frame';
type DB=Prisma.TransactionClient;
const notificationImage=resolve('public/notification.png');
const composedPhotos=new Map<string,Promise<Buffer|null>>();

export function telegramCampaignText(kind:string,title:string,body:string,name?:string){
 if(kind==='BROADCAST')return body;
 const greeting=name?`ሰላም ${name}፣\n\n`:'';
 return `${greeting}${title}\n\n${body}`;
}

export async function notificationPhoto(tx:DB,imageId:string|undefined,imagePath=notificationImage){
 const hasBadge=existsSync(imagePath);
 if(!imageId)return hasBadge?new InputFile(imagePath):null;
 const cacheKey=`${imagePath}:${imageId}:${hasBadge?statSync(imagePath).mtimeMs:'no-badge'}`;
 let pending=composedPhotos.get(cacheKey);
 if(!pending){
  pending=(async()=>{
  const media=await tx.managedMedia.findUnique({where:{id:imageId},select:{bytes:true}});
  if(!media)return null;
  const frame=await telegramPhotoFrame(sharp(Buffer.from(media.bytes),{limitInputPixels:16_000_000}).rotate().resize(900,900,{fit:'inside',withoutEnlargement:true}).png());
  if(!hasBadge)return frame.data;
  const {width,height}=frame.info;
  const badge=await sharp(imagePath).resize({width:Math.min(width,Math.max(72,Math.round(width*0.2))),height:Math.min(height,Math.max(72,Math.round(height*0.2))),fit:'inside'}).png().toBuffer({resolveWithObject:true});
  return sharp(frame.data).composite([{input:badge.data,left:Math.max(0,width-badge.info.width-12),top:Math.max(0,height-badge.info.height-12)}]).png().toBuffer();
  })();
  if(composedPhotos.size>=10)composedPhotos.clear();
  composedPhotos.set(cacheKey,pending);
 }
 let photo:Buffer|null;try{photo=await pending}catch(error){composedPhotos.delete(cacheKey);throw error}
 if(!photo){composedPhotos.delete(cacheKey);return null}
 return new InputFile(photo,'notification.png');
}
export async function notificationContent(tx:DB,row:Pick<Outbox,'kind'|'payload'>&Partial<Pick<Outbox,'key'>>){
 if(notificationRetired(row.kind))return null;
 if(['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'].includes(row.kind))return privateNotificationContent(tx,row);
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

const endingKinds=endingReminders.map(reminder=>reminder.kind);
const promotionKinds=['AUCTION_PUBLISHED',upcomingReminder.kind,...retiredPreStartReminderKinds,...endingKinds,'GLOBAL_CAMPAIGN'];
const safeDeleteWindowMs=47*60*60*1000;

async function retireAuctionNotifications(tx:DB,auctionId:string,now:Date,endingOnly:boolean){
 const jobKind=endingOnly
  ?Prisma.sql`(job.kind IN (${Prisma.join(endingKinds)}) OR
    (job.kind='GLOBAL_CAMPAIGN' AND job.payload->>'deliveryKind' IN (${Prisma.join(endingKinds)})))`
  :Prisma.sql`job.kind IN (${Prisma.join(promotionKinds)})`;
 const jobFilter=Prisma.sql`job.payload ? 'auctionId' AND job.payload->>'auctionId'=${auctionId} AND ${jobKind}`;
 const reason=endingOnly?'SUPERSEDED_BY_DEADLINE_CHANGE':'AUCTION_RETIRED';
 const retiredAt=Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
 const [summary]=await tx.$queryRaw<Array<{matched:number;skipped:number}>>(Prisma.sql`
  WITH jobs AS MATERIALIZED (
   SELECT job.id,job.key FROM "Outbox" job WHERE ${jobFilter}
  ), inbox_removed AS (
   DELETE FROM "NotificationInbox" inbox USING jobs WHERE inbox.key=jobs.key
  ), skipped AS (
   UPDATE "Outbox" job
   SET state='SKIPPED',"lastError"=${reason},"leaseToken"=NULL,"leaseUntil"=NULL
   FROM jobs WHERE job.id=jobs.id AND job.state='PENDING'
   AND (job."leaseUntil" IS NULL OR job."leaseUntil"<=${retiredAt})
   RETURNING job.id
  )
  SELECT (SELECT count(*) FROM jobs)::int AS matched,(SELECT count(*) FROM skipped)::int AS skipped
 `);
 if(endingOnly&&!summary.matched)return {...summary,telegramDeletesQueued:0,telegramDeletesUnavailable:0};

 // Acknowledge delivered messages in bulk after the send jobs were retired.
 // This stays in the auction transaction so a rollback also rolls back deletion requests.
 const messageFilter=endingOnly
  ?Prisma.sql`message."outboxId" IN (SELECT job.id FROM "Outbox" job WHERE ${jobFilter})`
  :Prisma.sql`message."auctionId"=${auctionId}`;
 const oldestDeletable=Prisma.sql`(${new Date(now.getTime()-safeDeleteWindowMs).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
 const [deletions]=await tx.$queryRaw<Array<{telegramDeletesQueued:number;telegramDeletesUnavailable:number}>>(Prisma.sql`
  WITH messages AS (
   UPDATE "TelegramMessage" message
   SET "deletionState"=CASE WHEN message."sentAt">${oldestDeletable} THEN 'QUEUED' ELSE 'UNAVAILABLE' END,
       "deletionError"=CASE WHEN message."sentAt">${oldestDeletable} THEN message."deletionError" ELSE 'TELEGRAM_DELETE_WINDOW_EXPIRED' END,
       "deletionRequestedAt"=${retiredAt}
   WHERE ${messageFilter} AND message."deletionState"='DELIVERED'
   RETURNING message.id,message."testRunId",message."deletionState"
  ), queued AS (
   INSERT INTO "Outbox" (id,key,kind,payload,"testRunId","createdAt","nextAttemptAt")
   SELECT gen_random_uuid()::text,'telegram-delete:'||id,'TELEGRAM_DELETE',jsonb_build_object('telegramMessageId',id),"testRunId",${retiredAt},${retiredAt}
   FROM messages WHERE "deletionState"='QUEUED'
   ON CONFLICT (key) DO NOTHING
  )
  SELECT count(*) FILTER (WHERE "deletionState"='QUEUED')::int AS "telegramDeletesQueued",
         count(*) FILTER (WHERE "deletionState"='UNAVAILABLE')::int AS "telegramDeletesUnavailable"
  FROM messages
 `);
 return {...summary,...deletions};
}

export async function retireAuctionPromotions(tx:DB,auctionId:string,now:Date){
 const {skipped,telegramDeletesQueued,telegramDeletesUnavailable}=await retireAuctionNotifications(tx,auctionId,now,false);
 return {pendingSkipped:skipped,telegramDeletesQueued,telegramDeletesUnavailable};
}

export async function retireAuctionEndingAlerts(tx:DB,auctionId:string,now:Date){
 const {matched,telegramDeletesQueued,telegramDeletesUnavailable}=await retireAuctionNotifications(tx,auctionId,now,true);
 return {endingAlertsRetired:matched,telegramDeletesQueued,telegramDeletesUnavailable};
}
