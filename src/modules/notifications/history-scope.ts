import {Prisma} from '@prisma/client';
import {deliveryNotificationKinds, retiredNotificationKinds} from './policy';

export const historyDeliveryKinds = [...deliveryNotificationKinds, ...retiredNotificationKinds];
export const historyKind = Prisma.sql`CASE
  WHEN r.kind='GLOBAL_CAMPAIGN' THEN r.payload->>'deliveryKind'
  WHEN r.kind='AUCTION_FINALIZED' THEN 'AUCTION_ENDED'
  ELSE r.kind END`;

// A history row represents either a campaign root or an individual notification.
// Fan-out rows are counted under their root. Older standalone Telegram deliveries
// can still appear even when their kind is no longer in the active policy.
export const isNotificationHistoryRow = Prisma.sql`
  r."testRunId" IS NULL AND COALESCE(r.payload->>'rootKey',r.key)=r.key
  AND CASE
    WHEN r.kind='GLOBAL_CAMPAIGN' THEN r.payload->>'cursor' IS NULL
      AND r.payload->>'deliveryKind' IN (${Prisma.join(historyDeliveryKinds)})
    WHEN r.kind='AUCTION_FINALIZED' THEN true
    WHEN r.kind IN ('AUCTION_PARTICIPANTS','BROADCAST_DELETE','TELEGRAM_DELETE') THEN false
    WHEN r.kind='BROADCAST' AND r.key LIKE '%:user:%' THEN NOT EXISTS (
      SELECT 1 FROM "Outbox" parent
      WHERE parent.key=regexp_replace(r.key, ':user:[^:]+$', '') AND parent.kind='GLOBAL_CAMPAIGN'
    )
    ELSE r.kind IN (${Prisma.join(historyDeliveryKinds)})
      OR EXISTS (SELECT 1 FROM "TelegramMessage" recorded WHERE recorded."outboxId"=r.id)
  END`;

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
    AND o.kind IN ('GLOBAL_CAMPAIGN',${historyKind})
  UNION ALL
  SELECT o.* FROM "Outbox" o
  WHERE r.kind='GLOBAL_CAMPAIGN' AND r.payload->>'deliveryKind'='BROADCAST'
    AND o.kind IN ('BROADCAST','GLOBAL_CAMPAIGN')
    AND o.payload->>'rootKey' IS NULL AND starts_with(o.key,r.key||':')
    AND o."testRunId" IS NULL`;
