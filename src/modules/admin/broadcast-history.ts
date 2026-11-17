import {Prisma,type PrismaClient} from '@prisma/client';
import {AdminError} from './errors';
import type {CampaignPayload} from '../notifications/campaigns';
import {broadcastButtonLabel,broadcastMiniAppPath} from '../../lib/broadcast-link';
import {auctionNotificationImagePath,queueGlobal} from '../notifications/campaigns';
import {promotionNow,readAuctionPromotion} from '../notifications/auction-promotion';
import {queueBroadcastDeletion} from '../notifications/broadcast-delete';
import {existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

type DeliveryProgress={id:string;sent:bigint;pending:bigint;skipped:bigint;failed:bigint;batches:bigint;failedBatches:bigint;blocked:bigint;invalid:bigint;exhausted:bigint;retrying?:bigint;inFlight?:bigint};

export const STOPPED='CAMPAIGN_STOPPED';
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
 const content={...target,body:p.body,buttonLabel,telegramOnly:true,parentCampaignId:row.id,...(p.imageId?{imageId:p.imageId}:{}),...(p.imagePath?{imagePath:p.imagePath}:{})};
 // Two separate HTTP/audit keys may still confirm the same resend identity.
 // Serialize it before Prisma's read-then-insert upsert, which can race.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${campaignKey}`},0))`;
 const job=await queueGlobal(tx,campaignKey,'BROADCAST',content),saved=job.payload as CampaignPayload;
 if(Object.entries(content).some(([field,value])=>saved[field as keyof CampaignPayload]!==value)||saved.imageId!==content.imageId||saved.imagePath!==content.imagePath||saved.auctionId!==content.auctionId)throw new AdminError(409,'This resend confirmation belongs to different broadcast content.');
 return {id:job.id,parentCampaignId:row.id,state:'PENDING'};
}
export async function deleteBroadcastMessages(tx:Prisma.TransactionClient,id:string){
 const {row}=await campaignRoot(tx,id);
 const stopped=await stopBroadcast(tx,id),deletion=await queueBroadcastDeletion(tx,row);
 return {...stopped,deletionJobId:deletion.id,deletionState:deletion.state};
}
export async function stopBroadcast(tx:Prisma.TransactionClient,id:string){
 const {row}=await campaignRoot(tx,id);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${row.key}`},0))`;
 const now=await promotionNow(tx);
 // Content stays immutable. The root marker also blocks future expansion/retries.
 await tx.outbox.update({where:{id},data:{state:'SKIPPED',lastError:STOPPED,leaseToken:null,leaseUntil:null}});
 // Do not revoke active send ownership: a request already accepted by Telegram
 // must still record its message ID. Claimed-but-not-sent rows recheck Stop.
 const remaining=await tx.outbox.updateMany({where:{key:{startsWith:row.key+':'},state:'PENDING',OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'SKIPPED',lastError:STOPPED,leaseToken:null,leaseUntil:null}});
 const leased=await tx.outbox.count({where:{key:{startsWith:row.key+':'},state:'PENDING',leaseUntil:{gt:now}}});
 return {id,stopped:true,remainingStopped:remaining.count,leasedAtStop:leased};
}
export async function broadcastHistory(client:PrismaClient,{page,q,view='history'}:{page:number;q:string;view?:'active'|'history'}){
 const where=Prisma.sql`kind='GLOBAL_CAMPAIGN' AND payload->>'deliveryKind'='BROADCAST' AND payload->>'rootKey'=key AND starts_with(key,'broadcast:') ${q?Prisma.sql`AND (payload->>'body' ILIKE ${'%'+q+'%'} OR key ILIKE ${'%'+q+'%'})`:Prisma.empty} ${view==='active'?Prisma.sql`AND (("lastError" IS DISTINCT FROM ${STOPPED} AND EXISTS(SELECT 1 FROM "Outbox" child WHERE (child.id="Outbox".id OR child.payload->>'rootKey'="Outbox".key) AND child.state='PENDING')) OR EXISTS(SELECT 1 FROM "Outbox" deletion WHERE deletion.key='broadcast-delete:'||"Outbox".id AND deletion.state='PENDING') OR EXISTS(SELECT 1 FROM "TelegramMessage" m JOIN "Outbox" sent ON sent.id=m."outboxId" JOIN "Outbox" d ON d.key='telegram-delete:'||m.id WHERE sent.payload->>'rootKey'="Outbox".key AND d.state='PENDING'))`:Prisma.empty}`;
 const [roots,count]=await Promise.all([client.$queryRaw<{id:string;key:string;payload:CampaignPayload;createdAt:Date;lastError:string|null}[]>(Prisma.sql`SELECT id,key,payload,"createdAt","lastError" FROM "Outbox" WHERE ${where} ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET ${(page-1)*25}`),client.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count FROM "Outbox" WHERE ${where}`)]);
 const progress=roots.length?await client.$queryRaw<DeliveryProgress[]>(Prisma.sql`SELECT r.id,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='SENT') AS sent,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='PENDING') AS pending,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='PENDING' AND o.attempts>0 AND (o."leaseUntil" IS NULL OR o."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))) AS retrying,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='PENDING' AND o."leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC')) AS "inFlight",
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='SKIPPED') AS skipped,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='FAILED') AS failed,
 COUNT(*) FILTER(WHERE o.kind='GLOBAL_CAMPAIGN' AND o.state='PENDING') AS batches,
 COUNT(*) FILTER(WHERE o.kind='GLOBAL_CAMPAIGN' AND o.state='FAILED') AS "failedBatches",
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='FAILED' AND o."lastError"='CHAT_BLOCKED') AS blocked,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='FAILED' AND o."lastError"='BAD_REQUEST') AS invalid,
 COUNT(*) FILTER(WHERE o.kind='BROADCAST' AND o.state='FAILED' AND o."lastError"='DELIVERY_RETRY') AS exhausted
 FROM "Outbox" r LEFT JOIN "Outbox" o ON o.id=r.id OR starts_with(o.key,r.key||':') WHERE r.id IN (${Prisma.join(roots.map(r=>r.id))}) GROUP BY r.id`):[];
 const slugs=roots.map(r=>r.payload.href?.split('/')[2]).filter((s):s is string=>!!s&&s!=='all'&&!/^\d+$/.test(s));
 const auctions=slugs.length?await client.auction.findMany({where:{slug:{in:slugs}},select:{slug:true,publicCode:true}}):[];
 const deletions=roots.length?await client.$queryRaw<{id:string;deleted:bigint;pending:bigint;failed:bigint;unavailable:bigint;preparing:boolean}[]>(Prisma.sql`
  SELECT r.id,COUNT(m.id) FILTER(WHERE m."deletionState"='DELETED') AS deleted,
  COUNT(m.id) FILTER(WHERE m."deletionState"='QUEUED' OR m."deletionState"='FAILED' AND d.state='PENDING') AS pending,
  COUNT(m.id) FILTER(WHERE m."deletionState"='FAILED' AND d.state='FAILED') AS failed,
  COUNT(m.id) FILTER(WHERE m."deletionState"='UNAVAILABLE') AS unavailable,
  COALESCE(bool_or(prep.state='PENDING'),false) AS preparing
  FROM "Outbox" r LEFT JOIN "Outbox" o ON o.kind='BROADCAST' AND (o.payload->>'rootKey'=r.key OR starts_with(o.key,r.key||':'))
  LEFT JOIN "TelegramMessage" m ON m."outboxId"=o.id LEFT JOIN "Outbox" d ON d.key='telegram-delete:'||m.id
  LEFT JOIN "Outbox" prep ON prep.key='broadcast-delete:'||r.id WHERE r.id IN (${Prisma.join(roots.map(r=>r.id))}) GROUP BY r.id`):[];
 const items=roots.map(r=>{
  const counts=progress.find(c=>c.id===r.id)!,sent=Number(counts.sent),pending=Number(counts.pending),skipped=Number(counts.skipped),failed=Number(counts.failed),batches=Number(counts.batches),failedBatches=Number(counts.failedBatches??0),blocked=Number(counts.blocked??0),invalid=Number(counts.invalid??0),exhausted=Number(counts.exhausted??0),code=r.payload.href?.split('/')[2];
  let buttonLabel='Open Lowwin',miniAppPath='/';try{buttonLabel=broadcastButtonLabel(r.payload.buttonLabel);miniAppPath=broadcastMiniAppPath(r.payload.href??'/')}catch{/* Historical unsupported links are not copied into a new draft. */}
  const retrying=Number(counts.retrying??0),inFlight=Number(counts.inFlight??0),recipientCount=sent+pending+skipped+failed;
  const deletion=deletions.find(d=>d.id===r.id),deletionProgress={deleted:Number(deletion?.deleted??0),pending:Number(deletion?.pending??0),failed:Number(deletion?.failed??0),unavailable:Number(deletion?.unavailable??0),preparing:deletion?.preparing??false};
  return {id:r.id,text:r.payload.body??'',imageId:r.payload.imageId??null,imagePath:r.payload.imagePath??null,parentCampaignId:r.payload.parentCampaignId??null,buttonLabel,miniAppPath,auctionCode:code&&/^\d+$/.test(code)?code:String(auctions.find(a=>a.slug===code)?.publicCode??''),createdAt:r.createdAt,sent,pending,queued:Math.max(0,pending-retrying-inFlight),retrying,inFlight,skipped,failed,pendingBatches:batches,failedBatches,recipientCount,eligibleRecipients:recipientCount,audienceComplete:batches===0&&failedBatches===0,failureReasons:{blocked,invalid,exhausted,other:Math.max(0,failed-blocked-invalid-exhausted)},deletion:deletionProgress,state:r.lastError===STOPPED?'STOPPED':pending||batches?sent?'SENDING':'QUEUED':failed||failedBatches?'NEEDS_ATTENTION':'COMPLETED',canStop:r.lastError!==STOPPED&&!!(pending||batches),canDelete:sent>0||pending>0||batches>0};
 });
 return {items,total:Number(count[0].count),page,totalPages:Math.ceil(Number(count[0].count)/25)};
}
