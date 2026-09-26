import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { assertLocalDevelopment } from '@/lib/env';

export const pointsSchema = z.string().regex(/^(0|[1-9]\d{0,15})$/).transform(BigInt);
export async function ensureWallet(tx: Prisma.TransactionClient, userId: string) {
  const wallet = await tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  for (const kind of ['AVAILABLE','HELD']) await tx.ledgerAccount.upsert({ where: { name: `user:${userId}:${kind.toLowerCase()}` }, create: { name: `user:${userId}:${kind.toLowerCase()}`, kind, walletId: wallet.id }, update: {} });
  return wallet;
}
export async function seedPlatformAccounts(tx: Prisma.TransactionClient) {
  await tx.ledgerAccount.createMany({ data: ['ISSUANCE','FEES','SETTLEMENT'].map(kind => ({ name: `platform:${kind.toLowerCase()}`, kind })), skipDuplicates: true });
}
export async function creditDevelopmentPoints(client: PrismaClient, userId: string, amount: string, key: string) {
  assertLocalDevelopment('points');
  const points = pointsSchema.parse(amount);
  if (points <= 0n || key.length < 8 || key.length > 128) throw new Error('Invalid seed request');
  const requestHash = createHash('sha256').update(amount).digest('hex');
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`}, 0))`;
    const previous = await tx.operation.findUnique({ where: { userId_scope_key: { userId, scope: 'DEV_CREDIT', key } } });
    if (previous) { if (previous.requestHash !== requestHash) throw new Error('Idempotency key reused with different request'); return previous.result; }
    await ensureWallet(tx, userId); await seedPlatformAccounts(tx);
    const available = await tx.ledgerAccount.findUniqueOrThrow({ where: { name: `user:${userId}:available` } });
    const funding = await tx.ledgerAccount.findUniqueOrThrow({ where: { name: 'platform:issuance' } });
    const result = { available: (available.balance + points).toString(), credited: points.toString() };
    const operation = await tx.operation.create({ data: { userId, scope: 'DEV_CREDIT', key, requestHash, result } });
    await tx.journal.create({ data: { operationId: operation.id, kind: 'DEV_CREDIT', reference: `development:${key}`, postings: { create: [
      { accountId: funding.id, delta: -points }, { accountId: available.id, delta: points },
    ] } } });
    return result;
  });
}
export async function reconcile(client: PrismaClient) {
  return client.$queryRaw<Array<{ name: string; projected: bigint; actual: bigint }>>`
    SELECT a.name, a.balance AS projected, COALESCE(SUM(p.delta),0)::bigint AS actual
    FROM "LedgerAccount" a LEFT JOIN "Posting" p ON p."accountId"=a.id
    GROUP BY a.id HAVING a.balance <> COALESCE(SUM(p.delta),0)`;
}
