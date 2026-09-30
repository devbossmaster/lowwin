import '@/lib/decimal-config';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { assertLocalDevelopment } from '@/lib/env';
import {stagingDemoUser} from '../auctions/staging-demo';

export const pointsSchema = z.string().regex(/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/).transform(value=>new Prisma.Decimal(value));
export async function ensureWallet(tx: Prisma.TransactionClient, userId: string) {
  const wallet = await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  await tx.$executeRaw`SELECT lock_wallet_hold_state(${wallet.id})`;
  for (const kind of ['AVAILABLE','HELD']) await tx.ledgerAccount.upsert({ where: { name: `user:${userId}:${kind.toLowerCase()}` }, create: { name: `user:${userId}:${kind.toLowerCase()}`, kind, walletId: wallet.id }, update: {} });
  return wallet;
}
export async function seedPlatformAccounts(tx: Prisma.TransactionClient) {
  await tx.ledgerAccount.createMany({ data: ['ISSUANCE','FEES','SETTLEMENT'].map(kind => ({ name: `platform:${kind.toLowerCase()}`, kind })), skipDuplicates: true });
}
export async function creditDevelopmentPoints(client: PrismaClient, userId: string, amount: string, key: string) {
  assertLocalDevelopment('points');
  return issuePoints(client,userId,amount,key,'DEV_CREDIT');
}
export async function creditDemoPoints(client:PrismaClient,userId:string,amount:string,key:string){
  if(!stagingDemoUser(userId)){assertLocalDevelopment('points')}
  if(pointsSchema.parse(amount).gt(5000)||!key.startsWith('demo-showcase:'))throw Error('Bounded explicit DEMO grant required');
  return issuePoints(client,userId,amount,key,'DEMO_CREDIT');
}
async function issuePoints(client:PrismaClient,userId:string,amount:string,key:string,scope:'DEV_CREDIT'|'DEMO_CREDIT'){
  return client.$transaction(tx=>issuePointsInTransaction(tx,userId,amount,key,scope));
}
async function issuePointsInTransaction(tx:Prisma.TransactionClient,userId:string,amount:string,key:string,scope:'DEV_CREDIT'|'DEMO_CREDIT'){
  const points = pointsSchema.parse(amount);
  if (points.lte(0) || key.length < 8 || key.length > 128) throw new Error('Invalid seed request');
  const requestHash = createHash('sha256').update(amount).digest('hex');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`}, 0))`;
  const previous = await tx.operation.findUnique({ where: { userId_scope_key: { userId, scope, key } } });
  if (previous) { if (previous.requestHash !== requestHash) throw new Error('Idempotency key reused with different request'); return previous.result; }
  await ensureWallet(tx, userId); await seedPlatformAccounts(tx);
  const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { name: `user:${userId}:available` } });
  const funding = await tx.ledgerAccount.findUniqueOrThrow({ where: { name: 'platform:issuance' } });
  const result = { available: available.balance.add(points).toString(), credited: points.toString() };
  const operation = await tx.operation.create({ data: { userId, scope, key, requestHash, result } });
  await tx.journal.create({ data: { operationId: operation.id, kind: scope, reference: `${scope==='DEMO_CREDIT'?'demo':'development'}:${key}`, postings: { create: [
    { accountId: funding.id, delta: points.negated() }, { accountId: available.id, delta: points },
  ] } } });
  return result;
}
export async function creditTestRunPoints(tx:Prisma.TransactionClient,userId:string,amount:string,key:string){
  if(!stagingDemoUser(userId)){assertLocalDevelopment('points')}
  if(pointsSchema.parse(amount).gt(5000)||!key.startsWith('demo-showcase:'))throw Error('Bounded explicit DEMO grant required');
  return issuePointsInTransaction(tx,userId,amount,key,'DEMO_CREDIT');
}
export async function reconcile(client: PrismaClient | Prisma.TransactionClient) {
  // One statement gives both comparisons the same MVCC snapshot.
  return client.$queryRaw<Array<{ kind: 'POSTING' | 'HOLD' | 'BID_FEE' | 'FEE_REFUND' | 'SETTLEMENT'; name: string; projected: Prisma.Decimal; actual: Prisma.Decimal }>>`
    SELECT 'POSTING' AS kind, a.name, a.balance AS projected, COALESCE(SUM(p.delta),0)::numeric AS actual
    FROM "LedgerAccount" a LEFT JOIN "Posting" p ON p."accountId"=a.id
    GROUP BY a.id HAVING a.balance <> COALESCE(SUM(p.delta),0)
    UNION ALL
    SELECT 'HOLD' AS kind, 'wallet:' || w.id AS name,
      COALESCE(a.balance,0)::numeric AS projected, COALESCE(SUM(h.points),0)::numeric AS actual
    FROM "Wallet" w
    LEFT JOIN "LedgerAccount" a ON a."walletId"=w.id AND a.kind='HELD'
    LEFT JOIN "AuctionHold" h ON h."walletId"=w.id
    GROUP BY w.id, a.balance HAVING COALESCE(a.balance,0) <> COALESCE(SUM(h.points),0)
    UNION ALL
    SELECT 'BID_FEE' AS kind, 'bid:' || b.id AS name, COALESCE(f.points,0)::numeric AS projected, b."feePoints" AS actual
    FROM "Bid" b LEFT JOIN LATERAL (
      SELECT SUM(p.delta) AS points FROM "Journal" j JOIN "Posting" p ON p."journalId"=j.id
      JOIN "LedgerAccount" a ON a.id=p."accountId" AND a.kind='FEES' WHERE j."operationId"=b."operationId"
    ) f ON true WHERE COALESCE(f.points,0)<>b."feePoints"
    UNION ALL
    SELECT 'FEE_REFUND' AS kind, 'settlement-user:' || m.id AS name, COALESCE(f.points,0)::numeric AS projected,
      CASE WHEN s.outcome='CANCELLED' THEN (SELECT COALESCE(SUM(b."feePoints"),0)::numeric FROM "Bid" b WHERE b."auctionId"=s."auctionId" AND b."userId"=m."userId") ELSE 0 END AS actual
    FROM "SettlementMovement" m JOIN "AuctionSettlement" s ON s.id=m."settlementId" LEFT JOIN LATERAL (
      SELECT SUM(-p.delta) AS points FROM "Journal" j JOIN "Posting" p ON p."journalId"=j.id
      JOIN "LedgerAccount" a ON a.id=p."accountId" AND a.kind='FEES' WHERE j."operationId"=m."refundOperationId"
    ) f ON true WHERE COALESCE(f.points,0)<>CASE WHEN s.outcome='CANCELLED' THEN (SELECT COALESCE(SUM(b."feePoints"),0) FROM "Bid" b WHERE b."auctionId"=s."auctionId" AND b."userId"=m."userId") ELSE 0 END
    UNION ALL
    SELECT 'SETTLEMENT' AS kind, 'settlement:' || s.id AS name, COALESCE(f.points,0)::numeric AS projected, COALESCE(s."winningPoints",0) AS actual
    FROM "AuctionSettlement" s LEFT JOIN LATERAL (
      SELECT SUM(p.delta) AS points FROM "SettlementMovement" m JOIN "Journal" j ON j."operationId"=m."chargeOperationId"
      JOIN "Posting" p ON p."journalId"=j.id JOIN "LedgerAccount" a ON a.id=p."accountId" AND a.kind='SETTLEMENT' WHERE m."settlementId"=s.id
    ) f ON true WHERE COALESCE(f.points,0)<>COALESCE(s."winningPoints",0)
    ORDER BY kind, name`;
}
