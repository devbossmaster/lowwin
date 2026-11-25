import {Prisma,type Outbox} from '@prisma/client';
import {promotionNow} from './auction-promotion';
import {isManagedBroadcast,isNotificationHistoryRow,relatedNotifications} from './history-scope';
import {AdminError} from '../admin/errors';

type Tx=Prisma.TransactionClient;
type DeletionPayload={campaignId:string;campaignRootKey:string;sentBefore?:string};
type RecordedMessage={id:string;sentAt:Date;testRunId:string|null};
export const telegramDeleteWindowMs=48*60*60*1000;
export function telegramMessageDeletable(sentAt:Date,now:Date){return sentAt<=now&&now.getTime()-sentAt.getTime()<telegramDeleteWindowMs}
const notificationDeleteKey=(id:string)=>`notification-delete:${id}`;
const notificationMessageScope=Prisma.sql`
 FROM "Outbox" r CROSS JOIN LATERAL (${relatedNotifications}) o
 JOIN "TelegramMessage" m ON m."outboxId"=o.id
 WHERE ${isNotificationHistoryRow} AND NOT COALESCE(${isManagedBroadcast},false)
   AND m."testRunId" IS NULL AND m."deletionState"='DELIVERED'`;

/** This durable control job keeps observing late acknowledgements after Stop.
 * It only queues deletion of this campaign's recorded messages, never media. */
export async function queueBroadcastDeletion(tx:Tx,campaign:{id:string;key:string}){
 return tx.outbox.upsert({where:{key:`broadcast-delete:${campaign.id}`},create:{key:`broadcast-delete:${campaign.id}`,kind:'BROADCAST_DELETE',payload:{campaignId:campaign.id,campaignRootKey:campaign.key}},update:{}});
}

/** Snapshot already-recorded deliveries. Scheduled and in-flight sends keep their claims. */
export async function queueNotificationDeletion(tx:Tx,id:string){
 const key=notificationDeleteKey(id);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
 const existing=await tx.outbox.findUnique({where:{key},select:{id:true,state:true}});
 if(existing?.state==='PENDING')return existing;
 const now=await promotionNow(tx),oldest=new Date(now.getTime()-telegramDeleteWindowMs);
 const [root]=await tx.$queryRaw<{key:string}[]>(Prisma.sql`
  SELECT r.key ${notificationMessageScope}
    AND r.id=${id} AND m."sentAt">${oldest} AND m."sentAt"<=${now}
  LIMIT 1`);
 if(!root)throw new AdminError(409,'No recorded Telegram messages are eligible for deletion within 48 hours.');
 const payload={campaignId:id,campaignRootKey:root.key,sentBefore:now.toISOString()};
 return tx.outbox.upsert({
  where:{key},create:{key,kind:'BROADCAST_DELETE',payload},
  update:{payload,state:'PENDING',attempts:0,leaseToken:null,leaseUntil:null,sentAt:null,lastError:null,nextAttemptAt:now},
  select:{id:true,state:true},
 });
}

async function queueRecordedDeletions(tx:Tx,messages:RecordedMessage[],now:Date,campaignId:string){
 const available=messages.filter(m=>telegramMessageDeletable(m.sentAt,now)),expired=messages.filter(m=>!telegramMessageDeletable(m.sentAt,now));
 if(available.length){
  await tx.outbox.createMany({data:available.map(m=>({key:`telegram-delete:${m.id}`,kind:'TELEGRAM_DELETE',payload:{telegramMessageId:m.id,campaignId},testRunId:m.testRunId})),skipDuplicates:true});
  await tx.telegramMessage.updateMany({where:{id:{in:available.map(m=>m.id)},deletionState:'DELIVERED'},data:{deletionState:'QUEUED',deletionRequestedAt:now,deletionError:null}});
 }
 if(expired.length)await tx.telegramMessage.updateMany({where:{id:{in:expired.map(m=>m.id)},deletionState:'DELIVERED'},data:{deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'}});
}

async function expandNotificationDeletion(tx:Tx,row:Outbox,p:DeletionPayload,sentBefore:Date){
 const now=await promotionNow(tx);
 if(!Number.isFinite(sentBefore.getTime())||sentBefore>now||row.key!==notificationDeleteKey(p.campaignId)){
  await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'NOTIFICATION_DELETE_TARGET_UNAVAILABLE'}});
  return 0;
 }
 const oldest=new Date(sentBefore.getTime()-telegramDeleteWindowMs);
 const messages=await tx.$queryRaw<RecordedMessage[]>(Prisma.sql`
  SELECT m.id,m."sentAt",m."testRunId" ${notificationMessageScope}
    AND r.id=${p.campaignId} AND r.key=${p.campaignRootKey} AND m."sentAt">${oldest} AND m."sentAt"<=${sentBefore}
  ORDER BY m."sentAt",m.id FOR UPDATE OF m LIMIT 250`);
 await queueRecordedDeletions(tx,messages,now,p.campaignId);
 const waiting=messages.length===250;
 await tx.outbox.update({where:{id:row.id},data:{state:waiting?'PENDING':'SENT',...(waiting?{nextAttemptAt:now}:{sentAt:now}),lastError:null}});
 return messages.length;
}

export async function expandBroadcastDeletion(tx:Tx,row:Outbox){
 const p=row.payload as DeletionPayload;
 if(p.sentBefore!==undefined)return expandNotificationDeletion(tx,row,p,new Date(p.sentBefore));
 const root=typeof p.campaignId==='string'?await tx.outbox.findUnique({where:{id:p.campaignId}}):null;
 if(!root||root.key!==p.campaignRootKey||root.kind!=='GLOBAL_CAMPAIGN'||(root.payload as {deliveryKind?:string}).deliveryKind!=='BROADCAST'||root.lastError!=='CAMPAIGN_STOPPED'){
  await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'BROADCAST_DELETE_TARGET_UNAVAILABLE'}});return 0;
 }
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${root.key}`},0))`;
 const now=await promotionNow(tx);
 // Expired send leases cannot keep deletion preparation waiting forever.
 await tx.outbox.updateMany({where:{kind:'BROADCAST',key:{startsWith:root.key+':'},state:'PENDING',OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:'CAMPAIGN_STOPPED',leaseToken:null,leaseUntil:null}});
 // Count before scanning messages. If an acknowledgement commits between
 // these reads, either its message is scanned now or this job runs again.
 const remaining=await tx.outbox.count({where:{kind:'BROADCAST',key:{startsWith:root.key+':'},state:'PENDING'}});
 const messages=await tx.$queryRaw<RecordedMessage[]>(Prisma.sql`
  SELECT m.id,m."sentAt",m."testRunId" FROM "TelegramMessage" m JOIN "Outbox" o ON o.id=m."outboxId"
  WHERE o.kind='BROADCAST' AND (o.payload->>'rootKey'=${root.key} OR starts_with(o.key,${root.key+':'})) AND m."deletionState"='DELIVERED'
  ORDER BY m.id FOR UPDATE OF m SKIP LOCKED LIMIT 250`);
 await queueRecordedDeletions(tx,messages,now,root.id);
 const waiting=messages.length===250||remaining>0;
 await tx.outbox.update({where:{id:row.id},data:{state:waiting?'PENDING':'SENT',...(waiting?{nextAttemptAt:new Date(now.getTime()+1000)}:{sentAt:now}),lastError:remaining?'WAITING_FOR_SEND_ACKNOWLEDGEMENTS':null}});
 return messages.length;
}
