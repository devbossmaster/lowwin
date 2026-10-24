import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {allowContactRequest} from '../src/modules/auth/contact-request-limit';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('atomic contact-request cooldown on disposable PostgreSQL', () => {
  let db: PrismaClient;
  let otherClient: PrismaClient;
  const player = () => `contact-limit-fixture-${randomUUID()}`;
  const key = (userId: string) => `own-contact-request:${userId}`;
  const row = (userId: string) => db.rateLimit.findUniqueOrThrow({where: {key: key(userId)}});
  const clock = async () => (await db.$queryRaw<{now: bigint}[]>`
    SELECT (extract(epoch FROM statement_timestamp()) * 1000)::bigint AS now
  `)[0].now;
  const seed = async (userId: string, offsetMs: bigint, count = 7) => {
    const id = randomUUID();
    const [created] = await db.$queryRaw<{id: string; key: string; count: number; lastRequest: bigint}[]>`
      INSERT INTO "rateLimit" (id, key, count, "lastRequest")
      VALUES (${id}, ${key(userId)}, ${count}, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint + ${offsetMs})
      RETURNING id, key, count, "lastRequest"
    `;
    return created;
  };

  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
      throw Error('Explicit disposable loopback TEST_DATABASE_URL ending in _test required');
    }
    // Prisma must not discover connection settings from a developer .env file.
    if (existsSync('.env') || existsSync('prisma/.env')) {
      throw Error('Run this suite from an env-file-free test checkout with explicit TEST_DATABASE_URL');
    }
    const env: NodeJS.ProcessEnv = {...process.env, DATABASE_URL: url!, DIRECT_URL: url!, APP_ENV: 'local', NODE_ENV: 'test'};
    const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {env, stdio: 'pipe'});
    db = new PrismaClient({datasourceUrl: url});
    otherClient = new PrismaClient({datasourceUrl: url});
  }, 60000);
  afterAll(async () => { await Promise.all([db?.$disconnect(), otherClient?.$disconnect()]); });

  it('allows exactly one concurrent first request across independent connection pools', async () => {
    const userId = player();
    const before = await clock();
    const results = await Promise.all(Array.from({length: 20}, (_, index) =>
      allowContactRequest(index % 2 ? db : otherClient, userId),
    ));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(result => !result)).toHaveLength(19);
    expect(await db.rateLimit.count({where: {key: key(userId)}})).toBe(1);
    const stored = await row(userId);
    expect(stored.count).toBe(1);
    expect(stored.lastRequest).toBeGreaterThanOrEqual(before);
    expect(stored.lastRequest).toBeLessThanOrEqual(await clock());
  });

  it('honors a historical same-key cooldown without overwriting its ID, timestamp or count', async () => {
    const userId = player();
    const historical = await seed(userId, -10000n);
    expect(await allowContactRequest(db, userId)).toBe(false);
    expect(await allowContactRequest(otherClient, userId)).toBe(false);
    expect(await row(userId)).toEqual(historical);
  });

  it('keeps separate user cooldowns independent', async () => {
    const first = player(), second = player();
    expect(await Promise.all([allowContactRequest(db, first), allowContactRequest(otherClient, second)])).toEqual([true, true]);
    expect(await Promise.all([allowContactRequest(db, first), allowContactRequest(otherClient, second)])).toEqual([false, false]);
    expect((await row(first)).key).not.toBe((await row(second)).key);
  });

  it('allows the next request after a full 60 seconds using the database clock', async () => {
    const userId = player();
    const historical = await seed(userId, -60000n);
    const before = await clock();
    expect(await allowContactRequest(db, userId)).toBe(true);
    const stored = await row(userId);
    expect(stored).toMatchObject({id: historical.id, key: historical.key, count: 1});
    expect(stored.lastRequest - historical.lastRequest).toBeGreaterThanOrEqual(60000n);
    expect(stored.lastRequest).toBeGreaterThanOrEqual(before);
    expect(stored.lastRequest).toBeLessThanOrEqual(await clock());
    expect(await allowContactRequest(db, userId)).toBe(false);
  });

  it('allows exactly one concurrent renewal of an expired existing cooldown', async () => {
    const userId = player();
    const historical = await seed(userId, -61000n);
    const results = await Promise.all(Array.from({length: 20}, (_, index) =>
      allowContactRequest(index % 2 ? db : otherClient, userId),
    ));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await row(userId)).toMatchObject({id: historical.id, key: historical.key, count: 1});
  });

  it('denies future-dated records without resetting their cooldown or stored evidence', async () => {
    const userId = player();
    const historical = await seed(userId, 120000n, 3);
    const results = await Promise.all([allowContactRequest(db, userId), allowContactRequest(otherClient, userId)]);
    expect(results).toEqual([false, false]);
    expect(await row(userId)).toEqual(historical);
  });

  it('uses the same atomic limiter with a transaction-scoped client', async () => {
    const userId = player();
    await db.$transaction(async tx => {
      expect(await allowContactRequest(tx, userId)).toBe(true);
      expect(await allowContactRequest(tx, userId)).toBe(false);
    });
    expect(await allowContactRequest(otherClient, userId)).toBe(false);
    expect(await db.rateLimit.count({where: {key: key(userId)}})).toBe(1);
  });
});
