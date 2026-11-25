import {Prisma,type PrismaClient,type Outbox} from '@prisma/client';
import {demoBidAllowed} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {auctionMaintenanceHalted,lockAuctionMaintenance} from '../auctions/maintenance';
import {broadcastMiniAppPath,broadcastButtonLabel} from '@/lib/broadcast-link';
import {resultRecipientIds} from './result-audience';
import {promotionNow,readAuctionPromotion} from './auction-promotion';
import {endingReminders,endingReminder,endingReminderCurrent,notificationRetired,upcomingReminders,upcomingReminder,upcomingReminderCurrent} from './policy';
import {auctionCountdownAm,auctionPromotionText} from './amharic-copy';

type Tx=Prisma.TransactionClient;
const when=(date:Date)=>`${formatAddisTimestamp(date,'am-ET')} (አዲስ አበባ)`;
export const telegramKinds=['AUCTION_PUBLISHED','AUCTION_UPCOMING_ADDED',...upcomingReminders.map(r=>r.kind),...endingReminders.map(r=>r.kind),'AUCTION_ENDED','DEPOSIT_CREDITED','BROADCAST'];
/** Only a published product's own local image may accompany its auction alert. */
export function auctionNotificationImagePath(presentation:unknown,productPath?:string){
 const image=typeof presentation==='object'&&presentation!==null&&'images' in presentation&&Array.isArray(presentation.images)?presentation.images[0]:null;
 const path=typeof image?.path==='string'?image.path:productPath;
 if(!path||path.includes('..'))return undefined;
 return /^\/api\/media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path)||/^\/(?:images|products)\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)$/i.test(path)?path:undefined;
}
export function auctionNotificationImageId(presentation:unknown,productPath?:string){
 return /^\/api\/media\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(auctionNotificationImagePath(presentation,productPath)??'')?.[1];
}
export type CampaignPayload={auctionId?:string;settlementId?:string;recipientUserId?:string;intentId?:string;body?:string;promotionTitle?:string;imageId?:string;imagePath?:string;href?:string;buttonLabel?:string;telegramOnly?:boolean;parentCampaignId?:string;cursor?:string;audienceBefore?:string;rootKey?:string;deliveryKind?:string};
export function broadcastRoot(row:Pick<Outbox,'kind'|'key'|'payload'>){
 const p=row.payload as CampaignPayload;
 if(row.kind==='GLOBAL_CAMPAIGN'&&p.deliveryKind==='BROADCAST')return p.rootKey??row.key;
 if(row.kind==='BROADCAST')return p.rootKey??(row.key.includes(':user:')?row.key.slice(0,row.key.lastIndexOf(':user:')):null);
 return null;
}
export async function broadcastStopped(tx:Tx,rootKey:string){return (await tx.outbox.findUnique({where:{key:rootKey},select:{lastError:true}}))?.lastError==='CAMPAIGN_STOPPED'}
export async function queueGlobal(tx:Tx,key:string,kind:string,payload:CampaignPayload){
 const now=await promotionNow(tx);
 const auction=payload.auctionId?await tx.auction.findUnique({where:{id:payload.auctionId},select:{testRunId:true}}):null;
 return tx.outbox.upsert({where:{key},create:{key,kind:'GLOBAL_CAMPAIGN',payload:{...payload,deliveryKind:kind,audienceBefore:now.toISOString(),rootKey:key},testRunId:auction?.testRunId},update:{}});
}
/** Each immutable batch records its cursor in a NEW intent. Recipients are
 * bounded by the event time; retrying a page cannot add duplicate deliveries. */
export async function expandCampaign(tx:Tx,row:Outbox){
 const p=row.payload as CampaignPayload;
 if(notificationRetired(p.deliveryKind??row.kind)){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'NOTIFICATION_RETIRED'}});return 0}
 let rootKey=p.rootKey??row.key,before=new Date(p.audienceBefore??row.createdAt.toISOString()),resultSettlementId:string|undefined;
 if(broadcastRoot(row)){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broadcast:${rootKey}`},0))`;
  if(await broadcastStopped(tx,rootKey)){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'}});return 0}
  if(p.auctionId&&(await readAuctionPromotion(tx,p.auctionId)).issue){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'AUCTION_RETIRED'}});return 0}
 }
 // Publication is the authority for every outcome. Canonical settlement keys
 // prevent duplicate logical announcements from legacy/retried root intents.
 if(row.kind==='AUCTION_FINALIZED'||p.deliveryKind==='AUCTION_ENDED'){
  const settlement=p.auctionId?await tx.auctionSettlement.findUnique({where:{auctionId:p.auctionId},select:{id:true,outcome:true,publication:{select:{publishedAt:true}}}}):null;
  if(!settlement?.publication||p.settlementId&&p.settlementId!==settlement.id||row.settlementId&&row.settlementId!==settlement.id){await tx.outbox.update({where:{id:row.id},data:{state:'SKIPPED',lastError:'RESULT_NOT_PUBLISHED'}});return 0}
  rootKey=`settlement:${settlement.id}:ended`;resultSettlementId=settlement.id;before=settlement.publication.publishedAt;
 }
 // Only reachable non-staff recipients enter fan-out. A later block or role
 // change is rechecked again immediately before the external delivery.
 const users=await resultRecipientIds(tx,before,p.cursor);
 const kind=row.kind==='AUCTION_FINALIZED'?'AUCTION_ENDED':p.deliveryKind;
 if(!kind||!telegramKinds.includes(kind))throw Error('Unknown campaign kind');
 const {cursor:_cursor,audienceBefore:_before,rootKey:_root,deliveryKind:_kind,...content}=p;
 if(users.length)await tx.outbox.createMany({data:users.map(user=>({key:`${rootKey}:user:${user.id}`,kind,payload:{...content,...(resultSettlementId?{settlementId:resultSettlementId}:{}),rootKey,recipientUserId:user.id},settlementId:resultSettlementId,testRunId:row.testRunId})),skipDuplicates:true});
 if(users.length===250){const cursor=users.at(-1)!.id;await tx.outbox.upsert({where:{key:`${rootKey}:after:${cursor}`},create:{key:`${rootKey}:after:${cursor}`,kind:'GLOBAL_CAMPAIGN',payload:{...p,...(resultSettlementId?{settlementId:resultSettlementId}:{}),deliveryKind:kind,rootKey,audienceBefore:before.toISOString(),cursor},settlementId:resultSettlementId,testRunId:row.testRunId},update:{}})}
 await tx.outbox.update({where:{id:row.id},data:{state:'SENT',sentAt:new Date()}});
 return users.length;
}
const reminderWindows=(reminders:readonly {kind:string;key:string;minMs:number;maxMs:number}[])=>Prisma.join(reminders.map(reminder=>
 Prisma.sql`(${reminder.kind}::text,${reminder.key}::text,${reminder.minMs}::bigint,${reminder.maxMs}::bigint)`));
const endingWindows=reminderWindows(endingReminders),startingWindows=reminderWindows(upcomingReminders);

export async function scheduleGlobalAlerts(client:PrismaClient){
 return client.$transaction(async tx=>{
  // Take the shared maintenance barrier first so the scan observes any halt
  // that committed while the worker waited for the lock.
  await lockAuctionMaintenance(tx);
  return tx.$executeRaw`
   WITH stamp AS MATERIALIZED (
    SELECT date_trunc('milliseconds',clock_timestamp() AT TIME ZONE 'UTC') AS now
    WHERE NOT ${auctionMaintenanceHalted}
   ), available AS NOT MATERIALIZED (
    SELECT a.id,a."startsAt",a."endsAt",a."controlVersion",stamp.now
    FROM stamp JOIN "Auction" a ON a."publishedAt"<=stamp.now
    JOIN "Product" p ON p.id=a."productId" AND p.visible
    WHERE a.status IN ('LIVE','SCHEDULED') AND a."testRunId" IS NULL
     AND (NOT a."isDemo" OR (a."isSettlementFixture" AND ${demoBidAllowed()||stagingDemoEnabled()}))
     AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
     AND NOT EXISTS(SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)
   ), due AS (
    SELECT a.id,a.now,r.kind,'global:'||r.prefix||':'||a.id||':v'||a."controlVersion" AS key
    FROM available a JOIN (VALUES ${endingWindows}) r(kind,prefix,minimum,maximum)
      ON a."endsAt">a.now+r.minimum*INTERVAL '1 millisecond' AND a."endsAt"<=a.now+r.maximum*INTERVAL '1 millisecond'
    WHERE a."startsAt"<=a.now
    UNION ALL
    SELECT a.id,a.now,r.kind,'global:'||r.prefix||':'||a.id AS key
    FROM available a JOIN (VALUES ${startingWindows}) r(kind,prefix,minimum,maximum)
      ON a."startsAt">a.now+r.minimum*INTERVAL '1 millisecond' AND a."startsAt"<=a.now+r.maximum*INTERVAL '1 millisecond'
    WHERE a."endsAt">a.now
   )
   INSERT INTO "Outbox" (id,key,kind,payload,"createdAt","nextAttemptAt")
   SELECT gen_random_uuid()::text,due.key,'GLOBAL_CAMPAIGN',jsonb_build_object(
    'auctionId',due.id,'deliveryKind',due.kind,'rootKey',due.key,
    'audienceBefore',to_char(due.now,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   ),due.now,due.now
   FROM due WHERE NOT EXISTS(SELECT 1 FROM "Outbox" existing WHERE existing.key=due.key)
   ORDER BY due.key ON CONFLICT (key) DO NOTHING
  `;
 },{maxWait:5000,timeout:30000});
}
export async function campaignContent(tx:Tx,row:Pick<Outbox,'kind'|'payload'>){
 const p=row.payload as CampaignPayload;if(!p.recipientUserId||!telegramKinds.includes(row.kind))return null;
 const base={userId:p.recipientUserId,kind:row.kind,imageId:undefined as string|undefined,imagePath:undefined as string|undefined,fallbackImagePath:undefined as string|undefined};
 if(row.kind==='BROADCAST'){
  if(!p.body||!p.href)return null;
  let body=p.body;
  // A product promotion must still refer to a visible, accepting auction.
  if(p.auctionId){
   const promotion=await readAuctionPromotion(tx,p.auctionId);
   if(promotion.issue||!promotion.auction?.endsAt)return null;
   if(p.promotionTitle)body=auctionPromotionText(p.promotionTitle,promotion.auction.endsAt,promotion.now);
  }
  let href:string,buttonLabel:string;try{href=broadcastMiniAppPath(p.href);buttonLabel=broadcastButtonLabel(p.buttonLabel)}catch{return null}
  return {...base,title:'የLowWin መረጃ',body,href,imageId:p.imageId,imagePath:p.imagePath,buttonLabel};
 }
 if(row.kind==='DEPOSIT_CREDITED'){
  if(!p.intentId)return null;
  const t=await tx.topUpIntent.findUnique({where:{id:p.intentId},select:{userId:true,status:true,points:true,provider:true}});
  if(!t||t.userId!==p.recipientUserId||t.status!=='CREDITED')return null;
  if(t.provider==='ADMIN_CREDIT')return {...base,title:'ገንዘብ ተጨምሯል',body:`የLowWin አስተዳዳሪ ${formatEtb(t.points)} ወደ ዋሌትዎ ጨምሯል።`,href:'/wallet',buttonLabel:'ዋሌቴን ይመልከቱ'};
  return {...base,title:'ገንዘቡ ገብቷል',body:`${formatEtb(t.points)} ወደ ዋሌትዎ ገብቷል።`,href:'/wallet',buttonLabel:'ዋሌቴን ይመልከቱ'};
 }
 if(!p.auctionId)return null;
 const a=await tx.auction.findUnique({where:{id:p.auctionId},select:{slug:true,publicCode:true,publishedAt:true,startsAt:true,endsAt:true,status:true,isDemo:true,isSettlementFixture:true,testRunId:true,presentation:true,product:{select:{title:true,titleAm:true,visible:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}},result:{select:{id:true}},settlement:{select:{id:true,outcome:true,completedAt:true,publication:{select:{publishedAt:true}}}}}});
 if(!a?.publishedAt||!a.slug||a.result||a.testRunId||a.isDemo&&(!a.isSettlementFixture||!(demoBidAllowed()||stagingDemoEnabled())))return null;
 const now=await promotionNow(tx);
 if(a.publishedAt>now)return null;
 const presentation=a.presentation as {title?:unknown;titleAm?:unknown;images?:{path?:unknown}[]}|null;
 const title=typeof presentation?.titleAm==='string'&&presentation.titleAm.trim()?presentation.titleAm:a.product?.titleAm|| (typeof presentation?.title==='string'?presentation.title:a.product?.title);
 base.imagePath=auctionNotificationImagePath(presentation,a.product?.images?.[0]?.path);
 base.imageId=auctionNotificationImageId(presentation,a.product?.images?.[0]?.path);
 const prefix=a.isDemo?'ማሳያ · ':'',shortItem=(title??'ጨረታ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
 const action={buttonLabel:'ጨረታውን ይመልከቱ',href:`/auctions/${a.slug}`};
 if(row.kind==='AUCTION_ENDED'){
  const settlement=a.settlement;
  if(!settlement?.publication||settlement.publication.publishedAt>now||settlement.completedAt>now||!a.endsAt||a.endsAt>now||!['CLOSED','CANCELLED'].includes(a.status)||p.settlementId&&p.settlementId!==settlement.id||a.publicCode===null)return null;
  // Publication freezes the product image in its durable root intent. Later
  // Winners-only banners/photos neither change queued messages nor resend them.
  if(p.imagePath!==undefined){base.imagePath=auctionNotificationImagePath({images:[{path:p.imagePath}]});base.imageId=auctionNotificationImageId({images:[{path:p.imagePath}]})}
  if(settlement.outcome==='CANCELLED'){
   const title=prefix+'ጨረታው ተሰርዟል / Auction cancelled',body=`የ${shortItem} ጨረታ ተሰርዟል። የተከፈሉ ክፍያዎች መመለሻ ሁኔታን በዋሌትዎ ይመልከቱ።\nThis auction was cancelled. Check your wallet for the committed refund status.`;
   return {...base,title,body,telegramCaption:`${title}\n\n${body}`,buttonLabel:'ዝርዝሩን ይመልከቱ',href:`/auctions/${a.slug}`};
  }
  const heading=prefix+'ጨረታው ተጠናቋል',body=`የ${shortItem} ጨረታ ተጠናቋል። ውጤቱን ለማየት ከታች ይጫኑ።`;
  return {...base,title:heading,body,telegramCaption:`${heading}\n\n${body}`,buttonLabel:'ውጤቱን ይመልከቱ',href:`/winners/${a.publicCode}`};
 }
 if(!['LIVE','SCHEDULED'].includes(a.status)||!a.product?.visible||!a.endsAt||a.endsAt<=now)return null;
 const starting=upcomingReminder(row.kind);
 if(starting){
  if(a.settlement||!a.startsAt)return null;
  if(!upcomingReminderCurrent(row.kind,a.startsAt,now))return null;
  const title=`${prefix}ጨረታው ሊጀምር ${auctionCountdownAm(a.startsAt,now)} ቀርቷል`;
  const body=`${shortItem}\nየሚጀምርበት፦ ${when(a.startsAt)}`;
  return {...base,...action,title,body,telegramCaption:`⏰ ${title}\n\n${body}`};
 }
 const reminder=endingReminder(row.kind);
 if(reminder){
  if(a.settlement||!a.startsAt||a.startsAt>now||!endingReminderCurrent(row.kind,a.endsAt,now))return null;
  const title=`${prefix}ጨረታው ሊያበቃ ${auctionCountdownAm(a.endsAt,now)} ቀርቷል`;
  const body=`${shortItem}\nየመዝጊያ ሰዓት፦ ${when(a.endsAt)}`;
  return {...base,...action,title,body,telegramCaption:`⌛ ${title}\n\n${body}`};
 }
 if(row.kind==='AUCTION_UPCOMING_ADDED'){
  if(a.settlement||!a.startsAt||a.startsAt<=now)return null;
  return {...base,...action,title:prefix+'🔥 አዲስ መጪ ጨረታ',body:`${shortItem}\nየሚጀምርበት፦ ${when(a.startsAt)}`,telegramCaption:`🔥 ${prefix}አዲስ መጪ ጨረታ\n\nሰላም {name}፣\n${shortItem}\nየሚጀምርበት፦ ${when(a.startsAt)}`};
 }
 if(row.kind==='AUCTION_PUBLISHED'){
  if(a.settlement||!a.startsAt||a.startsAt>now)return null;
  return {...base,...action,title:prefix+'🔥 አዲስ ጨረታ ተጀምሯል',body:`${shortItem}\nዕቃውንና የጨረታውን ውሎች ይመልከቱ።`,telegramCaption:`🔥 ${prefix}አዲስ ጨረታ ተጀምሯል\n\nሰላም {name}፣\n${shortItem}\nጨረታውን ለመቀላቀል ከታች ይጫኑ።`};
 }
 return null;
}
