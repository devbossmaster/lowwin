import {Prisma,type PrismaClient} from '@prisma/client';
import {AdminError} from './errors';
import type {CampaignPayload} from '../notifications/campaigns';
import {broadcastButtonLabel,broadcastMiniAppPath} from '../../lib/broadcast-link';
import {auctionNotificationImagePath,queueGlobal} from '../notifications/campaigns';
import {promotionNow,readAuctionPromotion} from '../notifications/auction-promotion';
import {queueBroadcastDeletion,telegramDeleteWindowMs} from '../notifications/broadcast-delete';
import {historyDeliveryKinds,historyKind,isManagedBroadcast,isNotificationHistoryRow,relatedNotifications} from '../notifications/history-scope';
import {CAMPAIGN_STOPPED,campaignLockKey} from '../notifications/campaign-control';
import {notificationHistoryLabel} from '@/lib/notification-history-labels';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

type DeliveryProgress={id:string;sent:bigint;pending:bigint;skipped:bigint;failed:bigint;batches:bigint;failedBatches:bigint;blocked:bigint;invalid:bigint;exhausted:bigint;retrying:bigint;inFlight:bigint;lastSentAt:Date|null;deletable:bigint;expired:bigint;deleted:bigint;deletionPending:bigint;deletionFailed:bigint;unavailable:bigint;preparing:boolean};

async function campaignRoot(tx:Prisma.TransactionClient,id:string){
 const row=await tx.outbox.findUnique({where:{id}}),p=row?.payload as CampaignPayload|undefined;
 if(!row||row.kind!=='GLOBAL_CAMPAIGN'||p?.deliveryKind!=='BROADCAST'||p.rootKey!==row.key||!row.key.startsWith('broadcast:'))throw new AdminError(404,'Broadcast not found.');
 return {row,p};
}
/** User-supplied paths and historical campaigns receive the same current
 * public-auction eligibility check as the auction-specific composer. */
export async function broadcastTarget(tx:Prisma.TransactionClient,href:string,auctionId?:string){
 const path=broadcastMiniAppPath(href),code=/^\/auctions\/([1-9]\d*)$/.exec(path)?.[1];
 if(!code){if(auctionId)throw new AdminError(422,'The original auction destination is unavailable.');return {href:path}}
 const linked=await tx.auction.findUnique({where:{publicCode:Number(code)},select:{id:true}});
 if(!linked||auctionId&&linked.id!==auctionId)throw new AdminError(422,'The linked auction is unavailable.');
 const {issue}=await readAuctionPromotion(tx,linked.id);
 if(issue)throw new AdminError(422,issue);
 return {href:path,auctionId:linked.id};
}
export async function resendBroadcast(tx:Prisma.TransactionClient,id:string,campaignKey:string){
 const {row,p}=await campaignRoot(tx,id);
 if(!p.body||p.body.length>700)throw new AdminError(422,'This historical message cannot be resent.');
 let href:string,buttonLabel:string;try{href=broadcastMiniAppPath(p.href??'/');buttonLabel=broadcastButtonLabel(p.buttonLabel)}catch{throw new AdminError(422,'This historical destination cannot be resent.')}
 const target=await broadcastTarget(tx,href,p.auctionId);
 if(p.imageId&&!await tx.managedMedia.findFirst({where:{id:p.imageId,purpose:'CATALOG'},select:{id:true}}))throw new AdminError(422,'The original broadcast image is no longer available.');
 if(p.imagePath){
  if(auctionNotificationImagePath({images:[{path:p.imagePath}]})!==p.imagePath)throw new AdminError(422,'The original image is unavailable.');
  const media=/^\/api\/media\/([0-9a-f-]{36})$/i.exec(p.imagePath)?.[1];
  if(media&&!await tx.managedMedia.findFirst({where:{id:media,purpose:'CATALOG'},select:{id:true}}))throw new AdminError(422,'The original broadcast image is no longer available.');
  if(!media){const local=resolve('public','.'+p.imagePath);if(!existsSync(local)||!statSync(local).isFile())throw new AdminError(422,'The original broadcast image is no longer available.')}
 }
 const content={...target,body:p.body,buttonLabel,telegramOnly:true,parentCampaignId:row.id,...(p.promotionTitle?{promotionTitle:p.promotionTitle}:{}),...(p.imageId?{imageId:p.imageId}:{}),...(p.imagePath?{imagePath:p.imagePath}:{})};
 // Two separate HTTP/audit keys may still confirm the same resend identity.
 // Serialize it before Prisma's read-then-insert upsert, which can race.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${campaignKey}`},0))`;
 const job=await queueGlobal(tx,campaignKey,'BROADCAST',content),saved=job.payload as CampaignPayload;
 if(Object.entries(content).some(([field,value])=>saved[field as keyof CampaignPayload]!==value)||saved.imageId!==content.imageId||saved.imagePath!==content.imagePath||saved.auctionId!==content.auctionId||saved.promotionTitle!==content.promotionTitle)throw new AdminError(409,'This resend confirmation belongs to different broadcast content.');
 return {id:job.id,parentCampaignId:row.id,state:'PENDING'};
}
export async function deleteBroadcastMessages(tx:Prisma.TransactionClient,id:string){
 const {row}=await campaignRoot(tx,id);
 const stopped=await stopCampaign(tx,row),deletion=await queueBroadcastDeletion(tx,row);
 return {...stopped,deletionJobId:deletion.id,deletionState:deletion.state};
}
export async function stopBroadcast(tx:Prisma.TransactionClient,id:string){
 const [row]=await tx.$queryRaw<{id:string;key:string}[]>(Prisma.sql`
  SELECT r.id,r.key FROM "Outbox" r WHERE r.id=${id} AND ${isNotificationHistoryRow}`);
 if(!row)throw new AdminError(404,'Public campaign not found.');
 return stopCampaign(tx,row);
}

async function stopCampaign(tx:Prisma.TransactionClient,{id,key}:{id:string;key:string}){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${campaignLockKey(key)},0))`;
 // Content stays immutable. The root marker also blocks future expansion/retries.
 await tx.outbox.update({where:{id},data:{state:'SKIPPED',lastError:CAMPAIGN_STOPPED,leaseToken:null,leaseUntil:null}});
 // Do not revoke active send ownership: a request already accepted by Telegram
 // must still record its message ID. Claimed-but-not-sent rows recheck Stop.
 const [counts]=await tx.$queryRaw<{remainingStopped:number;leasedAtStop:number}[]>(Prisma.sql`
  WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now),
  children AS MATERIALIZED (
    SELECT o.id,o."leaseUntil" FROM "Outbox" r CROSS JOIN LATERAL (${relatedNotifications}) o
    WHERE r.id=${id} AND o.id<>r.id AND o.state='PENDING'
  ), stopped AS (
    UPDATE "Outbox" o SET state='SKIPPED',"lastError"=${CAMPAIGN_STOPPED},"leaseToken"=NULL,"leaseUntil"=NULL
    FROM children c,stamp WHERE o.id=c.id AND o.state='PENDING' AND (o."leaseUntil" IS NULL OR o."leaseUntil"<=stamp.now)
    RETURNING o.id
  )
  SELECT (SELECT COUNT(*)::int FROM stopped) AS "remainingStopped",
    (SELECT COUNT(*)::int FROM children c,stamp WHERE c."leaseUntil">stamp.now) AS "leasedAtStop"`);
 return {id,stopped:true,...counts};
}
export type NotificationHistorySource='all'|'manual'|'automatic';

export async function broadcastHistory(client:PrismaClient,{
 page,q,view='history',source='all',
}:{page:number;q:string;view?:'active'|'history';source?:NotificationHistorySource}){
 const auctionJoin=Prisma.sql`LEFT JOIN "Auction" a ON a.id=r.payload->>'auctionId'
   LEFT JOIN "Product" product ON product.id=a."productId"`;
 const auctionTitle=Prisma.sql`COALESCE(r.payload->>'promotionTitle',a.presentation->>'title',product.title)`;
 const keyword='%'+q+'%';
 const matchingKinds=historyDeliveryKinds.filter(kind=>notificationHistoryLabel(kind).toLowerCase().includes(q.toLowerCase()));
 const sourceFilter=view==='active'?Prisma.sql`true`:source==='manual'?Prisma.sql`${historyKind}='BROADCAST'`
  :source==='automatic'?Prisma.sql`${historyKind}<>'BROADCAST'`:Prisma.sql`true`;
 const where=Prisma.sql`${isNotificationHistoryRow} AND ${sourceFilter}
  ${q?Prisma.sql`AND (r.payload->>'body' ILIKE ${keyword} OR r.key ILIKE ${keyword}
   OR ${auctionTitle} ILIKE ${keyword} OR product."titleAm" ILIKE ${keyword}
   OR a."publicCode"::text ILIKE ${keyword} OR ${historyKind} ILIKE ${keyword}
   ${matchingKinds.length?Prisma.sql`OR ${historyKind} IN (${Prisma.join(matchingKinds)})`:Prisma.empty})`:Prisma.empty}
  ${view==='active'?Prisma.sql`AND (
    EXISTS(SELECT 1 FROM "Outbox" prep WHERE prep.key=(CASE WHEN ${isManagedBroadcast} THEN 'broadcast-delete:' ELSE 'notification-delete:' END)||r.id AND prep.state='PENDING')
    OR EXISTS(
      SELECT 1 FROM (${relatedNotifications}) child
      LEFT JOIN "TelegramMessage" m ON m."outboxId"=child.id
      LEFT JOIN "Outbox" d ON d.key='telegram-delete:'||m.id
      WHERE (r."lastError" IS DISTINCT FROM ${CAMPAIGN_STOPPED} AND child.state='PENDING') OR d.state='PENDING'
    )
  )`:Prisma.empty}`;
 type Root={id:string;payload:CampaignPayload;createdAt:Date;state:string;lastError:string|null;notificationKind:string;managed:boolean;auctionTitle:string|null;publicCode:number|null};
 const [roots,count]=await Promise.all([
  client.$queryRaw<Root[]>(Prisma.sql`SELECT r.id,r.payload,r."createdAt",r.state,r."lastError",
   ${historyKind} AS "notificationKind",${isManagedBroadcast} AS managed,
   ${auctionTitle} AS "auctionTitle",a."publicCode"
   FROM "Outbox" r ${auctionJoin} WHERE ${where} ORDER BY r."createdAt" DESC,r.id LIMIT 25 OFFSET ${(page-1)*25}`),
  client.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count FROM "Outbox" r ${q?auctionJoin:Prisma.empty} WHERE ${where}`),
 ]);
 const deliverable=Prisma.sql`o.kind NOT IN ('GLOBAL_CAMPAIGN','AUCTION_FINALIZED')`;
 const acknowledged=Prisma.sql`${deliverable} AND o.state='SENT' AND o."lastError" IS DISTINCT FROM 'RESULT_ALREADY_DELIVERED'`;
 const pendingSend=Prisma.sql`${deliverable} AND o.state='PENDING'`;
 const preparingAudience=Prisma.sql`o.kind IN ('GLOBAL_CAMPAIGN','AUCTION_FINALIZED')`;
 const progress=roots.length?await client.$queryRaw<DeliveryProgress[]>(Prisma.sql`
  WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
  SELECT r.id,
    COUNT(*) FILTER(WHERE ${acknowledged}) AS sent,
    MAX(o."sentAt") FILTER(WHERE ${acknowledged}) AS "lastSentAt",
    COUNT(*) FILTER(WHERE ${pendingSend}) AS pending,
    COUNT(*) FILTER(WHERE ${pendingSend} AND o.attempts>0 AND (o."leaseUntil" IS NULL OR o."leaseUntil"<=stamp.now)) AS retrying,
    COUNT(*) FILTER(WHERE ${pendingSend} AND o."leaseUntil">stamp.now) AS "inFlight",
    COUNT(*) FILTER(WHERE ${deliverable} AND (o.state='SKIPPED' OR o."lastError"='RESULT_ALREADY_DELIVERED')) AS skipped,
    COUNT(*) FILTER(WHERE ${deliverable} AND o.state='FAILED') AS failed,
    COUNT(*) FILTER(WHERE ${preparingAudience} AND o.state='PENDING') AS batches,
    COUNT(*) FILTER(WHERE ${preparingAudience} AND o.state='FAILED') AS "failedBatches",
    COUNT(*) FILTER(WHERE ${deliverable} AND o.state='FAILED' AND o."lastError"='CHAT_BLOCKED') AS blocked,
    COUNT(*) FILTER(WHERE ${deliverable} AND o.state='FAILED' AND o."lastError"='BAD_REQUEST') AS invalid,
    COUNT(*) FILTER(WHERE ${deliverable} AND o.state='FAILED' AND o."lastError"='DELIVERY_RETRY') AS exhausted,
    COUNT(*) FILTER(WHERE m."deletionState"='DELIVERED' AND m."sentAt">stamp.now-${telegramDeleteWindowMs}*INTERVAL '1 millisecond' AND m."sentAt"<=stamp.now) AS deletable,
    COUNT(*) FILTER(WHERE m."deletionState"='DELIVERED' AND m."sentAt"<=stamp.now-${telegramDeleteWindowMs}*INTERVAL '1 millisecond') AS expired,
    COUNT(*) FILTER(WHERE m."deletionState"='DELETED') AS deleted,
    COUNT(*) FILTER(WHERE m."deletionState"='QUEUED' OR m."deletionState"='FAILED' AND d.state='PENDING') AS "deletionPending",
    COUNT(*) FILTER(WHERE m."deletionState"='FAILED' AND d.state='FAILED') AS "deletionFailed",
    COUNT(*) FILTER(WHERE m."deletionState"='UNAVAILABLE') AS unavailable,
    COALESCE(bool_or(prep.state='PENDING'),false) AS preparing
  FROM "Outbox" r CROSS JOIN stamp
  CROSS JOIN LATERAL (${relatedNotifications}) o
  LEFT JOIN "TelegramMessage" m ON m."outboxId"=o.id
  LEFT JOIN "Outbox" d ON d.key='telegram-delete:'||m.id
  LEFT JOIN "Outbox" prep ON prep.key=(CASE WHEN ${isManagedBroadcast} THEN 'broadcast-delete:' ELSE 'notification-delete:' END)||r.id
  WHERE r.id IN (${Prisma.join(roots.map(r=>r.id))}) GROUP BY r.id
 `):[];
 const statsById=new Map(progress.map(row=>[row.id,row]));
 const slugs=roots.map(r=>r.payload.href?.split('/')[2]).filter((s):s is string=>!!s&&s!=='all'&&!/^\d+$/.test(s));
 const auctions=slugs.length?await client.auction.findMany({where:{slug:{in:slugs}},select:{slug:true,publicCode:true}}):[];
 const items=roots.map(r=>{
  const counts=statsById.get(r.id)!;
  const sent=Number(counts.sent),pending=Number(counts.pending),skipped=Number(counts.skipped),failed=Number(counts.failed);
  const batches=Number(counts.batches),failedBatches=Number(counts.failedBatches??0),blocked=Number(counts.blocked??0),invalid=Number(counts.invalid??0),exhausted=Number(counts.exhausted??0);
  const code=r.payload.href?.split('/')[2],manual=r.notificationKind==='BROADCAST';
  let buttonLabel='Open Lowwin',miniAppPath='/';
  try{buttonLabel=broadcastButtonLabel(r.payload.buttonLabel);miniAppPath=broadcastMiniAppPath(r.payload.href??'/')}catch{/* Historical unsupported links are not copied into a new draft. */}
  const retrying=Number(counts.retrying??0),inFlight=Number(counts.inFlight??0),recipientCount=sent+pending+skipped+failed;
  const deletion={deleted:Number(counts.deleted??0),pending:Number(counts.deletionPending??0),failed:Number(counts.deletionFailed??0),unavailable:Number(counts.unavailable??0),expired:Number(counts.expired??0),deletable:Number(counts.deletable??0),preparing:counts.preparing??false};
  const canStop=r.lastError!==CAMPAIGN_STOPPED&&!!(pending||batches);
  const state=r.lastError===CAMPAIGN_STOPPED?'STOPPED':pending||batches?sent?'SENDING':'QUEUED'
    :failed||failedBatches?'NEEDS_ATTENTION':!sent&&(skipped||r.state==='SKIPPED')?'SKIPPED':'COMPLETED';
  return {
   id:r.id,kind:r.notificationKind,source:manual?'manual' as const:'automatic' as const,
   text:manual?r.payload.body??'':r.auctionTitle??'',imageId:manual?r.payload.imageId??null:null,
   imagePath:manual?r.payload.imagePath??null:null,parentCampaignId:manual?r.payload.parentCampaignId??null:null,
   buttonLabel,miniAppPath,auctionCode:r.publicCode?String(r.publicCode):code&&/^\d+$/.test(code)?code:String(auctions.find(a=>a.slug===code)?.publicCode??''),
   createdAt:r.createdAt,lastSentAt:counts.lastSentAt??null,sent,pending,queued:Math.max(0,pending-retrying-inFlight),
   retrying,inFlight,skipped,failed,pendingBatches:batches,failedBatches,recipientCount,eligibleRecipients:recipientCount,
   audienceComplete:batches===0&&failedBatches===0,failureReasons:{blocked,invalid,exhausted,other:Math.max(0,failed-blocked-invalid-exhausted)},
   deletion,state,canStop,canResend:!!r.managed,canDelete:!deletion.preparing&&(deletion.deletable>0||!!r.managed&&canStop),
  };
 });
 return {items,total:Number(count[0].count),page,totalPages:Math.ceil(Number(count[0].count)/25)};
}
