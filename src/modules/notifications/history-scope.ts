import {Prisma} from '@prisma/client';
import {endingReminders,retiredPreStartReminderKinds} from './policy';

export const historyDeliveryKinds = [
  'BROADCAST','AUCTION_PUBLISHED','AUCTION_UPCOMING','AUCTION_ENDED',
  ...retiredPreStartReminderKinds,
  ...endingReminders.map(reminder=>reminder.kind),
  'AUCTION_STARTING_SOON','AUCTION_RESULT',
];
export const historyKind = Prisma.sql`CASE
  WHEN r.kind='GLOBAL_CAMPAIGN' THEN r.payload->>'deliveryKind'
  WHEN r.kind='AUCTION_FINALIZED' THEN 'AUCTION_ENDED'
  ELSE r.kind END`;

// Show public campaigns and aggregate their Telegram deliveries under the root.
export const isNotificationHistoryRow = Prisma.sql`
  r."testRunId" IS NULL AND COALESCE(r.payload->>'rootKey',r.key)=r.key
  AND r.payload->>'recipientUserId' IS NULL AND r.key NOT LIKE '%:user:%'
  AND (r.kind<>'GLOBAL_CAMPAIGN' OR r.payload->>'cursor' IS NULL)
  AND ${historyKind} IN (${Prisma.join(historyDeliveryKinds)})`;

export const isManagedBroadcast = Prisma.sql`
  (r.kind='GLOBAL_CAMPAIGN' AND r.payload->>'deliveryKind'='BROADCAST'
    AND r.payload->>'rootKey'=r.key AND starts_with(r.key,'broadcast:'))`;

// Keep the indexed root lookup separate from the historical manual-broadcast
// key fallback. Both History and deletion resolve the same set of deliveries.
export const relatedNotifications = Prisma.sql`
  SELECT r.*
  UNION ALL
  SELECT o.* FROM "Outbox" o
  WHERE r.kind IN ('GLOBAL_CAMPAIGN','AUCTION_FINALIZED')
    AND o.payload->>'rootKey'=r.key AND o.id<>r.id AND o."testRunId" IS NULL
    AND (o.kind IN ('GLOBAL_CAMPAIGN',${historyKind}) OR (r.kind='AUCTION_FINALIZED' AND o.kind='AUCTION_RESULT'))
  UNION ALL
  SELECT o.* FROM "Outbox" o
  WHERE r.kind='GLOBAL_CAMPAIGN' AND r.payload->>'deliveryKind'='BROADCAST'
    AND o.kind IN ('BROADCAST','GLOBAL_CAMPAIGN')
    AND o.payload->>'rootKey' IS NULL AND starts_with(o.key,r.key||':')
    AND o."testRunId" IS NULL`;
