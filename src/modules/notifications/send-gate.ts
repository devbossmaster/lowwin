import {Prisma,type PrismaClient} from '@prisma/client';
import {broadcastRoot} from './campaigns';
import type {ClaimedNotification} from './leases';
import {endingReminder,notificationRetired} from './policy';

export type RecipientGate={telegramId:string;chatId:string;userId?:string;excludeStaff?:boolean};
export class DeliveryGate extends Error{constructor(readonly reason:string,readonly retry:boolean){super(reason)}}

/** One current-state read after the maintenance barrier replaces sequential ORM
 * reads. No cached recipient, Stop, ownership or maintenance decisions. The
 * transaction commits before each actual HTTP request, including photo retry. */
export async function beforeNotificationSend(client:PrismaClient,row:ClaimedNotification,shouldContinue:()=>boolean,logicalKey?:string,recipient?:RecipientGate){
 if(!shouldContinue())throw new DeliveryGate('WORKER_STOPPING',true);
 if(notificationRetired(row.kind))throw new DeliveryGate('NOTIFICATION_RETIRED',false);
 const p=row.payload as {recipientUserId?:string;auctionId?:string;botId?:string;telegramId?:string};
 const reminder=endingReminder(row.kind);
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
  const [gate]=await tx.$queryRaw<{now:Date;leaseUntil:Date|null;reason:string|null}[]>(Prisma.sql`
   SELECT stamp.now,o."leaseUntil",CASE
    WHEN (SELECT action FROM "AdminAudit" WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1)='AUCTIONS_MAINTENANCE_HALTED' THEN 'MAINTENANCE_PAUSED'
    WHEN o.id IS NULL OR o.state<>'PENDING' OR o."leaseToken" IS DISTINCT FROM ${row.leaseToken} OR o."leaseUntil" IS NULL OR o."leaseUntil"<=stamp.now THEN 'CLAIM_REPLACED'
    WHEN EXISTS(SELECT 1 FROM "Outbox" root WHERE root.key=${broadcastRoot(row)} AND root."lastError"='CAMPAIGN_STOPPED') THEN 'CAMPAIGN_STOPPED'
    WHEN ${logicalKey??null}::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "TelegramDeliveryLease" l WHERE l.key=${logicalKey??null} AND l."leaseToken"=${row.leaseToken} AND l."sentAt" IS NULL AND l."leaseUntil">stamp.now) THEN 'CLAIM_REPLACED'
    WHEN ${!!recipient} AND EXISTS(SELECT 1 FROM "BotChat" c WHERE c."telegramId"=${recipient?.telegramId??null} AND c.blocked) THEN 'CHAT_BLOCKED'
    WHEN ${!!recipient} AND NOT EXISTS(SELECT 1 FROM "BotChat" c WHERE c."telegramId"=${recipient?.telegramId??null} AND c."chatId"=${recipient?.chatId??null} AND NOT c.blocked) THEN 'CHAT_NOT_STARTED'
    WHEN ${!!(recipient?.excludeStaff&&recipient.userId)} AND NOT EXISTS(SELECT 1 FROM "user" u LEFT JOIN "StaffMember" s ON s."userId"=u.id WHERE u.id=${recipient?.userId??null} AND u."telegramId"=${recipient?.telegramId??null} AND u.role<>'admin' AND s."userId" IS NULL) THEN 'RECIPIENT_INELIGIBLE'
    WHEN ${row.kind==='CONTACT_CONFIRMED'} AND NOT EXISTS(SELECT 1 FROM "TelegramOwnContact" t WHERE t."botId"=${p.botId??null} AND t."telegramId"=${p.telegramId??null} AND t."revokedAt" IS NULL AND t."userId" IS NOT NULL) THEN 'CONTACT_REVOKED'
    WHEN ${row.kind==='AUCTION_RESULT'&&!!p.recipientUserId} AND NOT EXISTS(
     SELECT 1 FROM "user" u JOIN "NotificationPreference" n ON n."userId"=u.id AND n.telegram
      JOIN "BotChat" c ON c."telegramId"=u."telegramId" AND c."chatId"=u."telegramId" AND NOT c.blocked
      JOIN "TelegramOwnContact" t ON t."userId"=u.id AND t."telegramId"=u."telegramId" AND t."botId"=${process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]??''} AND t."revokedAt" IS NULL
      LEFT JOIN "StaffMember" s ON s."userId"=u.id WHERE u.id=${p.recipientUserId??null} AND u.role<>'admin' AND s."userId" IS NULL
    ) THEN 'RESULT_RECIPIENT_INELIGIBLE'
    WHEN ${row.kind==='AUCTION_RESULT'&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "AuctionSettlement" s ON s."auctionId"=a.id JOIN "ResultPublication" pub ON pub."settlementId"=s.id WHERE a.id=${p.auctionId??null} AND a.status='CLOSED' AND s.outcome='WINNER' AND s."completedAt"<=stamp.now AND pub."publishedAt"<=stamp.now) THEN 'RESULT_NOT_PUBLISHED'
    WHEN ${row.kind!=='AUCTION_RESULT'&&(row.kind==='BROADCAST'||row.kind.startsWith('AUCTION_'))&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "Product" product ON product.id=a."productId" WHERE a.id=${p.auctionId??null} AND a.status IN ('LIVE','SCHEDULED') AND a."endsAt">stamp.now AND product.visible) THEN 'AUCTION_RETIRED'
    WHEN ${row.kind==='BROADCAST'&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a WHERE a.id=${p.auctionId??null} AND a.status='LIVE' AND a."publishedAt"<=stamp.now AND a."startsAt"<=stamp.now AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)) THEN 'AUCTION_RETIRED'
    WHEN ${(!!reminder||row.kind==='AUCTION_UPCOMING')&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a WHERE a.id=${p.auctionId??null} AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id) AND CASE
     WHEN ${!!reminder} THEN a.status='LIVE' AND a."startsAt"<=stamp.now AND a."endsAt">stamp.now+${reminder?.minMs??0}*interval '1 millisecond' AND a."endsAt"<=stamp.now+${reminder?.maxMs??0}*interval '1 millisecond'
     ELSE a."startsAt">stamp.now AND a."startsAt"<=stamp.now+interval '24 hours' END) THEN 'AUCTION_RETIRED'
    ELSE NULL END AS reason
   FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now) stamp LEFT JOIN "Outbox" o ON o.id=${row.id}`);
  if(!gate||gate.reason)throw new DeliveryGate(gate?.reason??'CLAIM_REPLACED',['MAINTENANCE_PAUSED','CLAIM_REPLACED'].includes(gate?.reason??'CLAIM_REPLACED'));
  // Keep the usual path read-only. A near-expiry claim and any logical alias
  // renew together under current tokens; failed renewal rolls everything back.
  if(!gate.leaseUntil||gate.leaseUntil.getTime()-gate.now.getTime()<45_000){
   const renewed=new Date(gate.now.getTime()+120_000);
   if(!(await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{leaseUntil:renewed}})).count)throw new DeliveryGate('CLAIM_REPLACED',true);
   if(logicalKey&&!(await tx.telegramDeliveryLease.updateMany({where:{key:logicalKey,leaseToken:row.leaseToken,sentAt:null},data:{leaseUntil:renewed}})).count)throw new DeliveryGate('CLAIM_REPLACED',true);
   row.leaseUntil=renewed;
  }
 },{timeout:5000,maxWait:5000});
}
