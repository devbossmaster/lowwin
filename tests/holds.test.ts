import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { creditDevelopmentPoints, reconcile } from '../src/modules/wallet/ledger';
import { adjustAuctionHold, adjustAuctionHoldInTransaction } from '../src/modules/wallet/holds';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('database-enforced auction holds', () => {
  let db: PrismaClient;
  let userId: string, walletId: string, auctionId: string, otherAuctionId: string, availableId: string, heldId: string;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1','localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Disposable loopback _test DB required');
    Object.assign(process.env, { DATABASE_URL: url, DIRECT_URL: url, APP_ENV: 'local', NODE_ENV: 'test', DEV_POINTS_ENABLED: 'true' });
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js','migrate','deploy'], { env: process.env, stdio: 'pipe' });
    db = new PrismaClient();
  }, 60000);
  beforeEach(async () => {
    userId = randomUUID();
    await db.user.create({ data: { id: userId, name: 'Hold fixture' } });
    await creditDevelopmentPoints(db, userId, '1000', 'hold-fixture-funding');
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId }, include: { accounts: true } });
    walletId = wallet.id;
    availableId = wallet.accounts.find(a => a.kind === 'AVAILABLE')!.id;
    heldId = wallet.accounts.find(a => a.kind === 'HELD')!.id;
    auctionId = (await db.auction.create({ data: { code: randomUUID() } })).id;
    otherAuctionId = (await db.auction.create({ data: { code: randomUUID() } })).id;
  });
  afterAll(async () => { await db?.$disconnect(); });
  const command = (direction: 'RESERVE' | 'RELEASE', points: string, key = randomUUID(), auction = auctionId) => ({ userId, auctionId: auction, direction, points, key, reference: 'phase-1.5-fixture' });
  async function balances() {
    const accounts = await db.ledgerAccount.findMany({ where: { walletId } });
    return { available: accounts.find(a=>a.kind==='AVAILABLE')!.balance, held: accounts.find(a=>a.kind==='HELD')!.balance };
  }
  async function rawTransfer(tx: Prisma.TransactionClient, delta: bigint) {
    const op = await tx.operation.create({ data: { userId, scope: 'RAW_HOLD_TEST', key: randomUUID(), requestHash: 'fixture', result: {} } });
    await tx.journal.create({ data: { operationId: op.id, kind: 'HOLD_TEST', reference: auctionId, postings: { create: [{ accountId: availableId, delta: -delta }, { accountId: heldId, delta }] } } });
  }

  it('rejects an unmatched positive hold at commit', async () => {
    let reachedCommit = false;
    await expect(db.$transaction(async tx => {
      await tx.auctionHold.create({ data: { walletId, auctionId, points: 10n } });
      reachedCommit = true;
    })).rejects.toThrow(/HELD balance/);
    expect(reachedCommit).toBe(true);
    expect(await db.auctionHold.count({ where: { walletId } })).toBe(0);
    expect(await balances()).toEqual({ available: 1000n, held: 0n });
  });
  it('rejects a balanced HELD journal without a matching hold at commit', async () => {
    let reachedCommit = false;
    await expect(db.$transaction(async tx => { await rawTransfer(tx, 10n); reachedCommit = true; })).rejects.toThrow(/HELD balance/);
    expect(reachedCommit).toBe(true);
    expect(await balances()).toEqual({ available: 1000n, held: 0n });
    expect(await db.operation.count({ where: { userId, scope: 'RAW_HOLD_TEST' } })).toBe(0);
  });
  it('keeps zero holds valid, but checks later changes in the same transaction', async () => {
    const zero = await db.auctionHold.create({ data: { walletId, auctionId, points: 0n } });
    await expect(db.$transaction(async tx => {
      await tx.auctionHold.update({ where: { id: zero.id }, data: { points: 0n } });
      await tx.auctionHold.update({ where: { id: zero.id }, data: { points: 1n } });
    })).rejects.toThrow(/HELD balance/);
    await expect(db.$transaction(async tx => {
      const hold = await tx.auctionHold.create({ data: { walletId, auctionId: otherAuctionId, points: 0n } });
      await tx.auctionHold.update({ where: { id: hold.id }, data: { points: 1n } });
    })).rejects.toThrow(/HELD balance/);
    expect(await reconcile(db)).toEqual([]);
  });
  it.each(['hold-first','posting-first'])('allows matching transfers in either order: %s', async order => {
    await db.$transaction(async tx => {
      if (order === 'posting-first') await rawTransfer(tx, 50n);
      await tx.auctionHold.create({ data: { walletId, auctionId, points: 50n } });
      if (order === 'hold-first') await rawTransfer(tx, 50n);
    });
    expect(await balances()).toEqual({ available: 950n, held: 50n });
    expect(await reconcile(db)).toEqual([]);
  });
  it('reserves and releases across auctions with immutable journals and a zero final hold', async () => {
    await adjustAuctionHold(db, command('RESERVE','120'));
    await adjustAuctionHold(db, command('RESERVE','80',randomUUID(),otherAuctionId));
    await adjustAuctionHold(db, command('RELEASE','20'));
    expect(await balances()).toEqual({ available: 820n, held: 180n });
    await adjustAuctionHold(db, command('RELEASE','100'));
    await adjustAuctionHold(db, command('RELEASE','80',randomUUID(),otherAuctionId));
    expect(await balances()).toEqual({ available: 1000n, held: 0n });
    const ops = await db.operation.findMany({ where: { userId, scope: 'HOLD_ADJUST' }, include: { journal: { include: { postings: true } } } });
    expect(ops).toHaveLength(5);
    for (const op of ops) { expect(op.journal?.postings).toHaveLength(2); expect(op.journal!.postings.reduce((sum,p)=>sum+p.delta,0n)).toBe(0n); expect(op.journal!.reference).toContain('holdId'); }
    expect(await db.auctionHold.count({ where: { walletId, points: 0n } })).toBe(2);
    expect(await reconcile(db)).toEqual([]);
  });
  it('rolls back the operation and journal if the outer transaction fails', async () => {
    await expect(db.$transaction(async tx => { await adjustAuctionHoldInTransaction(tx, command('RESERVE','25')); throw new Error('later bid step failed'); })).rejects.toThrow('later bid step failed');
    expect(await balances()).toEqual({ available: 1000n, held: 0n });
    expect(await db.operation.count({ where: { userId, scope: 'HOLD_ADJUST' } })).toBe(0);
  });
  it('deduplicates concurrent reserves/releases and replays original results after later changes', async () => {
    const reserve = command('RESERVE','100');
    const results = await Promise.all(Array.from({length:6},()=>adjustAuctionHold(db,reserve)));
    for (const result of results) expect(result).toEqual(results[0]);
    const release = command('RELEASE','40');
    const released = await Promise.all(Array.from({length:4},()=>adjustAuctionHold(db,release)));
    for (const result of released) expect(result).toEqual(released[0]);
    expect(await adjustAuctionHold(db,reserve)).toEqual(results[0]);
    await expect(adjustAuctionHold(db,{...reserve, points:'101'})).rejects.toThrow('Idempotency');
    await expect(adjustAuctionHold(db,{...reserve, direction:'RELEASE'})).rejects.toThrow('Idempotency');
    expect(await balances()).toEqual({ available: 940n, held: 60n });
    expect(await db.operation.count({ where: { userId, scope: 'HOLD_ADJUST' } })).toBe(2);
    expect(await reconcile(db)).toEqual([]);
  });
  it('serializes different reserves against one wallet without overspending', async () => {
    const results = await Promise.allSettled([adjustAuctionHold(db,command('RESERVE','800')),adjustAuctionHold(db,command('RESERVE','500',randomUUID(),otherAuctionId))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    const total = await balances(); expect(total.available + total.held).toBe(1000n); expect(total.available).toBeGreaterThanOrEqual(0n);
    expect(await reconcile(db)).toEqual([]);
  });
  it('rejects over-release, zero/fractional movements and hold reassignment', async () => {
    await adjustAuctionHold(db,command('RESERVE','10'));
    await expect(adjustAuctionHold(db,command('RELEASE','11'))).rejects.toThrow('Cannot release');
    for (const amount of ['0','1.5','-1']) await expect(adjustAuctionHold(db,command('RESERVE',amount))).rejects.toThrow();
    const hold = await db.auctionHold.findFirstOrThrow({ where: { walletId } });
    await expect(db.auctionHold.update({ where: { id: hold.id }, data: { auctionId: otherAuctionId } })).rejects.toThrow('immutable');
    await expect(db.auctionHold.delete({ where: { id: hold.id } })).rejects.toThrow(/HELD balance/);
    await db.$transaction(async tx => { await rawTransfer(tx,-10n); await tx.auctionHold.delete({where:{id:hold.id}}); });
    expect(await reconcile(db)).toEqual([]);
  });
  it('reports hold drift inside a controlled uncommitted fixture, without disabling constraints', async () => {
    await expect(db.$transaction(async tx => {
      await tx.auctionHold.create({ data: { walletId, auctionId, points: 7n } });
      expect(await reconcile(tx)).toContainEqual({ kind:'HOLD', name:`wallet:${walletId}`, projected:0n, actual:7n });
      throw new Error('rollback drift fixture');
    })).rejects.toThrow('rollback drift fixture');
    expect(await reconcile(db)).toEqual([]);
  });
  it('serializes raw SQL writers even without the application advisory lock', async () => {
    await Promise.all([auctionId, otherAuctionId].map(auction => db.$transaction(async tx => {
      await tx.auctionHold.create({ data: { walletId, auctionId: auction, points: 35n } });
      await rawTransfer(tx,35n);
    })));
    expect(await balances()).toEqual({ available:930n, held:70n });
    expect(await reconcile(db)).toEqual([]);
  });
  it('rejects a stale repeatable-read writer after a concurrent wallet change', async () => {
    let snapshotReady!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve=>{snapshotReady=resolve;});
    const gate = new Promise<void>(resolve=>{resume=resolve;});
    const stale = db.$transaction(async tx => {
      await tx.ledgerAccount.findUniqueOrThrow({where:{id:heldId}});
      snapshotReady(); await gate;
      await tx.auctionHold.create({data:{walletId,auctionId:otherAuctionId,points:10n}});
      await rawTransfer(tx,10n);
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    const rejection = expect(stale).rejects.toThrow();
    await ready;
    try { await adjustAuctionHold(db,command('RESERVE','50')); } finally { resume(); }
    await rejection;
    expect(await balances()).toEqual({available:950n,held:50n});
    expect(await reconcile(db)).toEqual([]);
  });
});
