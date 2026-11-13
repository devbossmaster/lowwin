import type {Prisma,PrismaClient} from '@prisma/client';
import {depositBonusStorageReady} from './deposit-bonus';
export type DepositBonusDrift={kind:'DEPOSIT_BONUS';name:string;code:'PROJECTION'|'LOT_PROOF'|'MISSING_LOT'|'USE_PROOF'|'EXPIRY_PROOF'|'ORPHAN_JOURNAL'};
/** One read-only snapshot audits the separate liability. Expired lots waiting
 * for the worker remain a liability here, but are never spendable in wallet reads. */
export async function reconcileDepositBonuses(client:PrismaClient|Prisma.TransactionClient):Promise<DepositBonusDrift[]>{
 if(!await depositBonusStorageReady(client))return [];
 return client.$queryRaw<DepositBonusDrift[]>`
 WITH lots AS (
  SELECT l.*,COALESCE((SELECT sum(u."amountCents") FROM "DepositBonusUse" u WHERE u."checkoutId"=l."checkoutId"),0) AS used,COALESCE(e."amountCents",0) AS expired
  FROM "DepositBonusLot" l LEFT JOIN "DepositBonusExpiry" e ON e."checkoutId"=l."checkoutId"
 ), findings AS (
  SELECT 'wallet:'||w."userId" AS name,'PROJECTION' AS code FROM "Wallet" w LEFT JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='BONUS'
  WHERE COALESCE(a.balance,0)*100<>COALESCE((SELECT sum(l."amountCents"-l.used-l.expired) FROM lots l WHERE l."userId"=w."userId"),0)
  UNION ALL SELECT 'lot:'||l."checkoutId",'LOT_PROOF' FROM lots l LEFT JOIN "ChapaCheckout" c ON c.id=l."checkoutId"
   LEFT JOIN "Journal" j ON j.id=l."journalId" LEFT JOIN "Operation" o ON o.id=j."operationId"
   WHERE c.purpose IS DISTINCT FROM 'TOP_UP' OR c.status IS DISTINCT FROM 'CREDITED' OR c."userId" IS DISTINCT FROM l."userId"
    OR c."creditJournalId" IS NULL OR c."providerStatus" IS DISTINCT FROM 'SUCCESS' OR c."verificationState" IS DISTINCT FROM 'VERIFIED'
    OR j.kind IS DISTINCT FROM 'DEPOSIT_BONUS' OR o.scope IS DISTINCT FROM 'DEPOSIT_BONUS' OR o.key IS DISTINCT FROM l."checkoutId" OR o."userId" IS DISTINCT FROM l."userId"
    OR (c.initialization->'depositBonus'->>'amountCents')::bigint IS DISTINCT FROM l."amountCents"
    OR (c.initialization->'depositBonus'->>'policyVersion')::int IS DISTINCT FROM l."policyVersion"
    OR (c.initialization->'depositBonus'->>'validityDays')::int IS DISTINCT FROM l."validityDays" OR l.used+l.expired>l."amountCents"
    OR l."expiresAt"<>l."createdAt"+l."validityDays"*interval '1 day'
    OR (SELECT COALESCE(sum(p.delta),0) FROM "Posting" p JOIN "LedgerAccount" a ON a.id=p."accountId" WHERE p."journalId"=j.id AND a.name='user:'||l."userId"||':bonus')*100<>l."amountCents"
  UNION ALL SELECT 'checkout:'||c.id,'MISSING_LOT' FROM "ChapaCheckout" c WHERE c."creditJournalId" IS NOT NULL AND c.initialization->'depositBonus' IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM lots l WHERE l."checkoutId"=c.id)
  UNION ALL SELECT 'use:'||u.id,'USE_PROOF' FROM "DepositBonusUse" u JOIN lots l ON l."checkoutId"=u."checkoutId"
   LEFT JOIN "Bid" b ON b.id=u."bidId" LEFT JOIN "Operation" o ON o.id=u."operationId" LEFT JOIN "Journal" j ON j."operationId"=o.id
   WHERE b."userId" IS DISTINCT FROM u."userId" OR l."userId"<>u."userId" OR b."acceptedAt">=l."expiresAt" OR b."acceptedAt"<l."createdAt"
    OR o.scope IS DISTINCT FROM 'DEPOSIT_BONUS_USE' OR o.key IS DISTINCT FROM b.id OR j.kind IS DISTINCT FROM 'DEPOSIT_BONUS_USE'
  UNION ALL SELECT 'expiry:'||e."checkoutId",'EXPIRY_PROOF' FROM "DepositBonusExpiry" e JOIN lots l ON l."checkoutId"=e."checkoutId"
   LEFT JOIN "Journal" j ON j.id=e."journalId" LEFT JOIN "Operation" o ON o.id=j."operationId"
   WHERE e."userId"<>l."userId" OR e."createdAt"<l."expiresAt" OR e."amountCents"<>l."amountCents"-l.used
    OR e."amountCents">0 AND (j.kind IS DISTINCT FROM 'DEPOSIT_BONUS_EXPIRY' OR o.scope IS DISTINCT FROM 'DEPOSIT_BONUS_EXPIRY' OR o.key IS DISTINCT FROM l."checkoutId")
  UNION ALL SELECT 'journal:'||j.id,'ORPHAN_JOURNAL' FROM "Journal" j WHERE
   j.kind='DEPOSIT_BONUS' AND NOT EXISTS(SELECT 1 FROM lots l WHERE l."journalId"=j.id)
   OR j.kind='DEPOSIT_BONUS_USE' AND NOT EXISTS(SELECT 1 FROM "DepositBonusUse" u WHERE u."operationId"=j."operationId")
   OR j.kind='DEPOSIT_BONUS_EXPIRY' AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."journalId"=j.id)
 ) SELECT 'DEPOSIT_BONUS' AS kind,name,code FROM findings ORDER BY name,code`;
}
