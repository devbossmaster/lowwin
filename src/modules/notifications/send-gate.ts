import {Prisma,type PrismaClient} from '@prisma/client';
import {CAMPAIGN_STOPPED,campaignRootKey} from './campaign-control';
import {recordNotificationTiming} from './diagnostics';
import type {ClaimedNotification} from './leases';
import {notificationDatabasePathReady,notificationSendCapacityReady} from './notification-db-path';
import {endingReminder,notificationRetired,upcomingReminder} from './policy';
import type {TelegramSendGrant,TelegramSendReservation} from './telegram-rate';

export type RecipientGate={telegramId:string;chatId:string;userId?:string;excludeStaff?:boolean};
export class DeliveryGate extends Error{constructor(readonly reason:string,readonly retry:boolean){super(reason)}}
function rejectGate(reason:string):never{throw new DeliveryGate(reason,reason==='MAINTENANCE_PAUSED'||reason==='CLAIM_REPLACED')}
function isolationFallback(error:unknown){
 return error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'&&error.meta?.code==='0A000'
  &&typeof error.meta.message==='string'&&/^(?:ERROR: )?Notification gate requires READ COMMITTED$/.test(error.meta.message);
}
type GateDecision={reason:string|null;renewedUntil:Date|null};
function applyGate(row:ClaimedNotification,gate:GateDecision|undefined):asserts gate is GateDecision{
 if(!gate||gate.reason)rejectGate(gate?.reason??'CLAIM_REPLACED');
 if(gate.renewedUntil)row.leaseUntil=gate.renewedUntil;
}
function assertWorkerSending(row:ClaimedNotification,shouldContinue:()=>boolean){
 if(!shouldContinue())throw new DeliveryGate('WORKER_STOPPING',true);
 if(notificationRetired(row.kind))throw new DeliveryGate('NOTIFICATION_RETIRED',false);
}

function gateParameters(row:ClaimedNotification,logicalKey?:string,recipient?:RecipientGate){
 const p=row.payload as {recipientUserId?:string;auctionId?:string;botId?:string;telegramId?:string;bidId?:string;batchId?:string;checkoutId?:string;intentId?:string;settlementId?:string;refundId?:string;scheduledStartAt?:string};
 const reminder=endingReminder(row.kind);
 const bidId=p.bidId??/^bid:([0-9a-f-]{36}):accepted$/i.exec(row.key)?.[1];
 const botId=process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]??'';
 const chapaMode=process.env.CHAPA_MODE??'test',rootKey=campaignRootKey(row);
 const command={
  outboxId:row.id,leaseToken:row.leaseToken,kind:row.kind,logicalKey,rootKey,recipient,
  payloadUserId:p.recipientUserId,auctionId:p.auctionId,bidId,batchId:p.batchId,checkoutId:p.checkoutId,
  intentId:p.intentId,settlementId:p.settlementId,refundId:p.refundId,scheduledStartAt:p.scheduledStartAt,
  botId,chapaMode,upcomingLeadMs:upcomingReminder.leadMs,upcomingGraceMs:upcomingReminder.deliveryGraceMs,
  reminderMinMs:reminder?.minMs,reminderMaxMs:reminder?.maxMs,
 };
 return {p,reminder,bidId,botId,chapaMode,rootKey,command};
}

/** One rate decision, and a fresh eligibility check only if a slot is granted. */
export async function reserveNotificationSend(client:PrismaClient,row:ClaimedNotification,shouldContinue:()=>boolean,rate:TelegramSendReservation,logicalKey?:string,recipient?:RecipientGate):Promise<TelegramSendGrant|null>{
 assertWorkerSending(row,shouldContinue);
 if(!await notificationSendCapacityReady(client))return null;
 const {command}=gateParameters(row,logicalKey,recipient);
 const started=performance.now();
 try{
  const [gate]=await client.$queryRaw<(TelegramSendGrant&GateDecision)[]>`SELECT * FROM public.lowwin_reserve_notification_send(
   ${JSON.stringify(command)}::jsonb,${rate.botId},${rate.chatId},${rate.priority},${rate.globalMs}::integer,${rate.bulkMs}::integer,${rate.chatMs}::integer)`;
  if(gate?.granted||gate?.reason)recordNotificationTiming('gate',performance.now()-started);
  applyGate(row,gate);
  return gate;
 }catch(error){
  if(isolationFallback(error))return null;
  throw error;
 }
}

/** The standalone check supports rollout compatibility, deletions, and
 * adapters without the rate transformer. It still runs before each HTTP call. */
export async function beforeNotificationSend(client:PrismaClient,row:ClaimedNotification,shouldContinue:()=>boolean,logicalKey?:string,recipient?:RecipientGate){
 assertWorkerSending(row,shouldContinue);
 const {p,reminder,bidId,botId,chapaMode,rootKey,command}=gateParameters(row,logicalKey,recipient);
 if(await notificationDatabasePathReady(client)){
  try{
   const [gate]=await client.$queryRaw<GateDecision[]>`SELECT * FROM public.lowwin_gate_notification(${JSON.stringify(command)}::jsonb)`;
   applyGate(row,gate);
   return;
  }catch(error){
   if(!isolationFallback(error))throw error;
  }
 }
 const privateKind=['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'].includes(row.kind);
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('lowwin:auction-maintenance',0))`;
  const [gate]=await tx.$queryRaw<{now:Date;leaseUntil:Date|null;reason:string|null}[]>(Prisma.sql`
   SELECT stamp.now,o."leaseUntil",CASE
    WHEN (SELECT action FROM "AdminAudit" WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED') ORDER BY "createdAt" DESC,id DESC LIMIT 1)='AUCTIONS_MAINTENANCE_HALTED' THEN 'MAINTENANCE_PAUSED'
    WHEN o.id IS NULL OR o.state<>'PENDING' OR o."leaseToken" IS DISTINCT FROM ${row.leaseToken} OR o."leaseUntil" IS NULL OR o."leaseUntil"<=stamp.now THEN 'CLAIM_REPLACED'
    WHEN EXISTS(SELECT 1 FROM "Outbox" root WHERE root.key=${rootKey} AND root."lastError"=${CAMPAIGN_STOPPED}) THEN ${CAMPAIGN_STOPPED}
    WHEN ${logicalKey??null}::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "TelegramDeliveryLease" l WHERE l.key=${logicalKey??null} AND l."leaseToken"=${row.leaseToken} AND l."sentAt" IS NULL AND l."leaseUntil">stamp.now) THEN 'CLAIM_REPLACED'
    WHEN ${!!recipient} AND EXISTS(SELECT 1 FROM "BotChat" c WHERE c."telegramId"=${recipient?.telegramId??null} AND c.blocked) THEN 'CHAT_BLOCKED'
    WHEN ${!!recipient} AND NOT EXISTS(SELECT 1 FROM "BotChat" c WHERE c."telegramId"=${recipient?.telegramId??null} AND c."chatId"=${recipient?.chatId??null} AND NOT c.blocked) THEN 'CHAT_NOT_STARTED'
    WHEN ${!!(recipient?.excludeStaff&&recipient.userId)} AND NOT EXISTS(SELECT 1 FROM "user" u LEFT JOIN "StaffMember" s ON s."userId"=u.id WHERE u.id=${recipient?.userId??null} AND u."telegramId"=${recipient?.telegramId??null} AND u.role<>'admin' AND s."userId" IS NULL) THEN 'RECIPIENT_INELIGIBLE'
    WHEN ${!!recipient} AND NOT EXISTS(SELECT 1 FROM "user" u WHERE u.id=${recipient?.userId??null} AND u."telegramId"=${recipient?.telegramId??null}) THEN 'RECIPIENT_INELIGIBLE'
    WHEN ${!!recipient} AND ${recipient?.chatId??null}::text IS DISTINCT FROM ${recipient?.telegramId??null}::text THEN 'PRIVATE_CHAT_REQUIRED'
    WHEN ${!!recipient} AND EXISTS(SELECT 1 FROM "NotificationPreference" n WHERE n."userId"=${recipient?.userId??null} AND NOT n.telegram) THEN 'RECIPIENT_UNSUBSCRIBED'
    WHEN ${privateKind} AND (${p.recipientUserId??null}::text IS NULL OR ${p.recipientUserId??null}::text IS DISTINCT FROM ${recipient?.userId??null}::text) THEN 'RECIPIENT_INELIGIBLE'
    WHEN ${row.kind==='DEPOSIT_CREDITED'} AND NOT (
     EXISTS(SELECT 1 FROM "ChapaCheckout" c JOIN "Journal" j ON j.id=c."creditJournalId" WHERE c.id=${p.checkoutId??null} AND c."userId"=${p.recipientUserId??null} AND c.currency='ETB' AND c."amountCents">0 AND c."phoneBotId"=${botId} AND c.mode=${chapaMode} AND c."providerStatus"='SUCCESS' AND c."verificationState"='VERIFIED' AND ((c.purpose='TOP_UP' AND c.status='CREDITED') OR (c.purpose='BID' AND c.status='NEEDS_REVIEW' AND c."bidId" IS NULL)))
     OR EXISTS(SELECT 1 FROM "TopUpIntent" t JOIN "Journal" j ON j.id=t."journalId" WHERE t.id=${p.intentId??null} AND t."userId"=${p.recipientUserId??null} AND t.status='CREDITED' AND t.points>0)
    ) THEN 'DEPOSIT_NOT_CREDITED'
    WHEN ${row.kind==='BID_ACCEPTED'} AND NOT (
     (${!!p.batchId} AND EXISTS(SELECT 1 FROM "BidBatchOrder" b WHERE b.id=${p.batchId??null} AND b."userId"=${p.recipientUserId??null} AND b."auctionId"=${p.auctionId??null} AND b.status='ACCEPTED' AND b.receipt IS NOT NULL))
     OR (${!p.batchId} AND EXISTS(SELECT 1 FROM "Bid" b JOIN "Operation" o ON o.id=b."operationId" WHERE b.id=${bidId??null} AND b."userId"=${p.recipientUserId??null} AND b."auctionId"=${p.auctionId??null} AND o."userId"=b."userId" AND o.scope='BID'))
    ) THEN 'BID_NOT_ACCEPTED'
    WHEN ${row.kind==='AUCTION_FEE_REFUNDED'} AND NOT EXISTS(
     SELECT 1 FROM "AuctionRefund" r JOIN "AuctionSettlement" s ON s.id=r."settlementId" JOIN "Operation" op ON op.id=r."operationId" JOIN "Journal" j ON j."operationId"=op.id
     WHERE r.id=${p.refundId??null} AND r."userId"=${p.recipientUserId??null} AND s.id=${p.settlementId??null} AND s."auctionId"=${p.auctionId??null} AND s.outcome='CANCELLED' AND r.status='COMPLETED' AND r."completedAt"<=stamp.now
      AND op."userId"=r."userId" AND op.scope='AUCTION_FEE_REFUND' AND op.key=r.id AND op.result->>'refundId'=r.id AND op.result->>'settlementId'=s.id AND j.kind='AUCTION_FEE_REFUND'
    ) THEN 'REFUND_NOT_COMMITTED'
    WHEN ${row.kind==='WINNER_CONGRATULATIONS'} AND NOT EXISTS(
     SELECT 1 FROM "AuctionSettlement" s JOIN "Auction" a ON a.id=s."auctionId" JOIN "ResultPublication" pub ON pub."settlementId"=s.id JOIN "Bid" b ON b.id=s."winningBidId"
      WHERE s.id=${p.settlementId??null} AND s."auctionId"=${p.auctionId??null} AND s.outcome='WINNER' AND s."winnerUserId"=${p.recipientUserId??null} AND b."userId"=s."winnerUserId" AND b."auctionId"=s."auctionId" AND b.amount=s."winningPoints" AND a.status='CLOSED' AND s.cutoff<=stamp.now AND s."completedAt"<=stamp.now AND pub."publishedAt"<=stamp.now
    ) THEN 'RESULT_NOT_PUBLISHED'
    WHEN ${row.kind==='AUCTION_ENDED'} AND NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "AuctionSettlement" s ON s."auctionId"=a.id JOIN "ResultPublication" pub ON pub."settlementId"=s.id WHERE a.id=${p.auctionId??null} AND (${p.settlementId??null}::text IS NULL OR s.id=${p.settlementId??null}) AND a.status IN ('CLOSED','CANCELLED') AND s.cutoff<=stamp.now AND s."completedAt"<=stamp.now AND pub."publishedAt"<=stamp.now) THEN 'RESULT_NOT_PUBLISHED'
    WHEN ${!['AUCTION_ENDED','AUCTION_FEE_REFUNDED'].includes(row.kind)&&(row.kind==='BROADCAST'||row.kind.startsWith('AUCTION_'))&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a JOIN "Product" product ON product.id=a."productId" WHERE a.id=${p.auctionId??null} AND a.status IN ('LIVE','SCHEDULED') AND a."endsAt">stamp.now AND product.visible AND a."publishedAt"<=stamp.now AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)) THEN 'AUCTION_RETIRED'
    WHEN ${(row.kind==='BROADCAST'||row.kind==='AUCTION_PUBLISHED')&&!!p.auctionId} AND NOT EXISTS(
     SELECT 1 FROM "Auction" a JOIN "Product" product ON product.id=a."productId" JOIN "Category" pc ON pc.id=product."categoryId" LEFT JOIN "Category" ac ON ac.id=a."categoryId"
     WHERE a.id=${p.auctionId??null} AND a.status IN ('LIVE','SCHEDULED') AND a."startsAt"<=stamp.now AND a."endsAt">stamp.now AND a."publishedAt"<=stamp.now AND a."publicCode">0 AND a.slug IS NOT NULL AND product.visible AND pc.visible AND (ac.id IS NULL OR ac.visible) AND (${row.kind==='AUCTION_PUBLISHED'} OR NOT a."isDemo") AND a."testRunId" IS NULL
      AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id) AND NOT EXISTS(SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)
    ) THEN 'AUCTION_RETIRED'
    WHEN ${row.kind===upcomingReminder.kind} AND NOT EXISTS(SELECT 1 FROM "Auction" a WHERE a.id=${p.auctionId??null}
     AND to_char(a."startsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=${p.scheduledStartAt??null}
     AND a."publishedAt"<=a."startsAt"-${upcomingReminder.leadMs}*interval '1 millisecond'
     AND a."startsAt"<=stamp.now+${upcomingReminder.leadMs}*interval '1 millisecond'
     AND a."startsAt">stamp.now+${upcomingReminder.leadMs-upcomingReminder.deliveryGraceMs}*interval '1 millisecond') THEN 'AUCTION_RETIRED'
    WHEN ${!!reminder&&!!p.auctionId} AND NOT EXISTS(SELECT 1 FROM "Auction" a WHERE a.id=${p.auctionId??null}
     AND a.status IN ('LIVE','SCHEDULED') AND a."startsAt"<=stamp.now AND a."endsAt">stamp.now+${reminder?.minMs??0}*interval '1 millisecond' AND a."endsAt"<=stamp.now+${reminder?.maxMs??0}*interval '1 millisecond') THEN 'AUCTION_RETIRED'
    ELSE NULL END AS reason
   FROM (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now) stamp LEFT JOIN "Outbox" o ON o.id=${row.id}`);
  if(!gate||gate.reason)rejectGate(gate?.reason??'CLAIM_REPLACED');
  // Keep the usual path read-only. A near-expiry claim and any logical alias
  // renew together under current tokens; failed renewal rolls everything back.
  if(!gate.leaseUntil||gate.leaseUntil.getTime()-gate.now.getTime()<45_000){
   const renewed=new Date(gate.now.getTime()+120_000);
   if(!(await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{leaseUntil:renewed}})).count)throw new DeliveryGate('CLAIM_REPLACED',true);
   if(logicalKey&&!(await tx.telegramDeliveryLease.updateMany({where:{key:logicalKey,leaseToken:row.leaseToken,sentAt:null},data:{leaseUntil:renewed}})).count)throw new DeliveryGate('CLAIM_REPLACED',true);
   row.leaseUntil=renewed;
  }
 },{timeout:5000,maxWait:5000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
