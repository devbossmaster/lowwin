import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ensureWallet, pointsSchema } from './ledger';

const inputSchema = z.object({
  userId: z.string().min(1).max(128), auctionId: z.string().min(1).max(128),
  direction: z.enum(['RESERVE', 'RELEASE']), points: pointsSchema.refine(value => value > 0n),
  key: z.string().min(8).max(128), reference: z.string().min(1).max(200),
}).strict();
const resultSchema = z.object({
  operationId: z.string(), auctionId: z.string(), direction: z.enum(['RESERVE', 'RELEASE']),
  points: z.string(), auctionHeld: z.string(), available: z.string(), held: z.string(),
});
export type HoldAdjustment = z.input<typeof inputSchema>;

/** Internal only. Caller supplies the authenticated canonical user; no HTTP route.
 * Bids and settlement compose this inside the SAME transaction.
 * Lock auction first (if needed), then wallet; use ReadCommitted or retry an
 * entire transaction after PostgreSQL serialization/deadlock errors.
 */
export async function adjustAuctionHoldInTransaction(tx: Prisma.TransactionClient, input: HoldAdjustment) {
  const command = inputSchema.parse(input);
  const { userId, auctionId, direction, points, key, reference } = command;
  const requestHash = createHash('sha256').update(JSON.stringify({ auctionId, direction, points: points.toString(), reference })).digest('hex');
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`}, 0))`;
  const wallet = await ensureWallet(tx, userId);
  const previous = await tx.operation.findUnique({ where: { userId_scope_key: { userId, scope: 'HOLD_ADJUST', key } } });
  if (previous) {
    if (previous.requestHash !== requestHash) throw new Error('Idempotency key reused with different hold request');
    return resultSchema.parse(previous.result);
  }
  // The DB guard is held before reading either aggregate or projected balances.
  const accounts = await tx.ledgerAccount.findMany({ where: { walletId: wallet.id } });
  const available = accounts.find(account => account.kind === 'AVAILABLE')!;
  const held = accounts.find(account => account.kind === 'HELD')!;
  const hold = await tx.auctionHold.findUnique({ where: { walletId_auctionId: { walletId: wallet.id, auctionId } } });
  const current = hold?.points ?? 0n;
  if (direction === 'RESERVE' && available.balance < points) throw new Error('Insufficient available ETB');
  if (direction === 'RELEASE' && current < points) throw new Error('Cannot release more than this auction holds');
  const delta = direction === 'RESERVE' ? points : -points;
  const operationId = crypto.randomUUID();
  const result = { operationId, auctionId, direction, points: points.toString(), auctionHeld: (current + delta).toString(), available: (available.balance - delta).toString(), held: (held.balance + delta).toString() };
  await tx.operation.create({ data: { id: operationId, userId, scope: 'HOLD_ADJUST', key, requestHash, result } });
  const updatedHold = await tx.auctionHold.upsert({
    where: { walletId_auctionId: { walletId: wallet.id, auctionId } },
    create: { walletId: wallet.id, auctionId, points: current + delta }, update: { points: current + delta },
  });
  await tx.journal.create({ data: {
    operationId, kind: `HOLD_${direction}`, reference: JSON.stringify({ holdId: updatedHold.id, auctionId, reference }),
    postings: { create: [{ accountId: available.id, delta: -delta }, { accountId: held.id, delta }] },
  } });
  return result;
}

export async function adjustAuctionHold(client: PrismaClient, input: HoldAdjustment) {
  return client.$transaction(tx => adjustAuctionHoldInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
}
