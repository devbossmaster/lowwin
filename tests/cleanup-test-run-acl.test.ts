import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';

const sourceUrl = process.env.TEST_DATABASE_URL;
const historicalSql = readFileSync(new URL('../prisma/migrations/202609300006_live_controls_and_test_runs/migration.sql', import.meta.url), 'utf8');
const originalFunction = historicalSql.match(/CREATE FUNCTION cleanup_test_run\(target text\) RETURNS void[\s\S]*?END \$\$;/)?.[0];
if (!originalFunction) throw Error('Historical cleanup function fixture not found');
const migration = readFileSync(new URL('../prisma/migrations/202610220002_cleanup_test_run_acl/migration.sql', import.meta.url), 'utf8');

describe.skipIf(!sourceUrl)('cleanup_test_run execution ACL on disposable PostgreSQL', () => {
  let databaseUrl: string;
  let db: Client;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const staffRole = `cleanup_acl_staff_${suffix}`;
  const publicRole = `cleanup_acl_public_${suffix}`;
  const browserRoles = ['anon', 'authenticated'];
  const allowedRoles = ['lowwin_runtime', 'service_role', staffRole];
  const roles = [...browserRoles, ...allowedRoles, publicRole];
  const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const privileges = async (role: string) => (await db.query<{execute: boolean}>(
    `SELECT has_function_privilege($1, 'public.cleanup_test_run(text)', 'EXECUTE') AS execute`, [role],
  )).rows[0].execute;
  const metadata = async () => (await db.query(`
    SELECT pg_get_functiondef(oid) AS definition, proowner, prosecdef, proconfig
    FROM pg_proc WHERE oid = 'public.cleanup_test_run(text)'::regprocedure
  `)).rows[0];
  const acl = async (signature = 'public.cleanup_test_run(text)') => (await db.query(`
    SELECT a.grantor, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = $1::regprocedure ORDER BY a.grantor, a.grantee, a.privilege_type
  `, [signature])).rows;
  const counts = async () => (await db.query(`
    SELECT (SELECT count(*) FROM "TestRun")::int AS runs,
           (SELECT count(*) FROM "Auction")::int AS auctions,
           (SELECT count(*) FROM "TestRunActor")::int AS actors,
           (SELECT count(*) FROM "Product")::int AS products
  `)).rows[0];
  const callAs = async (role: string, target = 'ordinary-customer-run') => {
    await db.query('SAVEPOINT caller');
    try {
      await db.query(`SET LOCAL ROLE ${quoted(role)}`);
      return await db.query('SELECT public.cleanup_test_run($1::text)', [target]);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT caller');
      await db.query('RELEASE SAVEPOINT caller');
    }
  };

  beforeAll(async () => {
    // Never load .env, migrate/reset a caller's database, or connect remotely.
    const base = new URL(sourceUrl!);
    if (!['127.0.0.1', 'localhost'].includes(base.hostname) || !base.pathname.endsWith('_test')) {
      throw Error('Explicit disposable loopback TEST_DATABASE_URL ending in _test required');
    }
    const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
    const admin = new Client({connectionString: adminUrl.href, connectionTimeoutMillis: 5000});
    await admin.connect();
    try {
      const name = `lowwin_cleanup_acl_${suffix}_test`;
      await admin.query(`CREATE DATABASE ${quoted(name)}`);
      base.pathname = `/${name}`;
      databaseUrl = base.href;
    } finally { await admin.end(); }
  }, 30000);

  beforeEach(async () => {
    db = new Client({connectionString: databaseUrl, connectionTimeoutMillis: 5000});
    await db.connect();
    await db.query('BEGIN');
    await db.query(`SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '10s'`);
    // Roles are cluster-wide, so every fixture change is rolled back after each
    // test. Existing roles are neither dropped nor permanently reconfigured.
    for (const role of roles) {
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await db.query(`CREATE ROLE ${quoted(role)} NOLOGIN`);
      }
      await db.query(`GRANT USAGE ON SCHEMA public TO ${quoted(role)}`);
    }
    await db.query(`
      CREATE TABLE "TestRun" (id text PRIMARY KEY, state text NOT NULL);
      CREATE TABLE "Auction" (id text PRIMARY KEY, "testRunId" text);
      CREATE TABLE "TestRunActor" ("testRunId" text, "userId" text);
      CREATE TABLE "Product" (id text PRIMARY KEY, "testRunId" text);
      INSERT INTO "TestRun" VALUES ('ordinary-customer-run', 'FINISHED'), ('unfinished-run', 'RUNNING');
      INSERT INTO "Auction" VALUES ('customer-auction', 'ordinary-customer-run'), ('demo-auction', 'unfinished-run');
      INSERT INTO "TestRunActor" VALUES ('ordinary-customer-run', 'registered-customer'), ('unfinished-run', 'demo-showcase-abcd1234-1');
      INSERT INTO "Product" VALUES ('customer-product', 'ordinary-customer-run');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    `);
    await db.query(originalFunction!);
    // Reproduce the applied migration: PUBLIC revoked while explicit browser
    // grants (including grants inherited from creation defaults) survive.
    await db.query('REVOKE ALL ON FUNCTION public.cleanup_test_run(text) FROM PUBLIC');
    await db.query(`GRANT EXECUTE ON FUNCTION public.cleanup_test_run(text) TO lowwin_runtime, service_role, ${quoted(staffRole)} WITH GRANT OPTION`);
    await db.query(`
      CREATE FUNCTION public.cleanup_test_run(integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      CREATE FUNCTION public.cleanup_acl_unrelated() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);
  }, 30000);
  afterEach(async () => {
    if (db) { try { await db.query('ROLLBACK'); } finally { await db.end(); } }
  });
  it('removes explicit/default browser grants and preserves server grants, function code and unrelated ACLs', async () => {
    expect(await privileges(publicRole)).toBe(false);
    for (const role of browserRoles) expect(await privileges(role)).toBe(true);
    const before = await metadata(), beforeAcl = await acl();
    const overload = await acl('public.cleanup_test_run(integer)');
    const unrelated = await acl('public.cleanup_acl_unrelated()');
    const blocked = new Set([0, ...(await db.query<{oid: number}>('SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])', [browserRoles])).rows.map(row => row.oid)]);

    await db.query(migration);

    for (const role of [...browserRoles, publicRole]) expect(await privileges(role), role).toBe(false);
    for (const role of allowedRoles) expect(await privileges(role), role).toBe(true);
    expect(await acl()).toEqual(beforeAcl.filter(row => !blocked.has(row.grantee)));
    expect(await metadata()).toEqual(before);
    expect(before).toMatchObject({prosecdef: true, proconfig: ['search_path=public, pg_temp']});
    expect(await acl('public.cleanup_test_run(integer)')).toEqual(overload);
    expect(await acl('public.cleanup_acl_unrelated()')).toEqual(unrelated);
    const safeAcl = await acl(); await db.query(migration); expect(await acl()).toEqual(safeAcl);
  });

  it('denies actual browser and PUBLIC-only calls before entering the cleanup body', async () => {
    await db.query('GRANT EXECUTE ON FUNCTION public.cleanup_test_run(text) TO PUBLIC');
    expect(await privileges(publicRole)).toBe(true);
    const before = await counts();
    await db.query(migration);
    for (const role of [...browserRoles, publicRole]) {
      await expect(callAs(role)).rejects.toMatchObject({code: '42501', message: 'permission denied for function cleanup_test_run'});
    }
    expect(await counts()).toEqual(before);
  });

  it('preserves allowed staff/service/runtime invocation and both existing cleanup eligibility guards', async () => {
    await db.query(migration);
    const before = await counts();
    for (const role of allowedRoles) {
      // Never supply an eligible destructive fixture. These are the original
      // function's real guards: an ordinary customer and an unfinished test run.
      for (const target of ['ordinary-customer-run', 'unfinished-run']) {
        await expect(callAs(role, target)).rejects.toMatchObject({code: 'P0001', message: 'Eligible finished test run required'});
      }
    }
    expect(await counts()).toEqual(before);
  });

  it('fails atomically for inherited execution rather than removing runtime access or role memberships', async () => {
    await db.query('GRANT lowwin_runtime TO anon');
    const before = await acl();
    await db.query('SAVEPOINT migration_attempt');
    await expect(db.query(migration)).rejects.toMatchObject({code: '42501', message: 'Browser role anon still has cleanup_test_run(text) execution access'});
    await db.query('ROLLBACK TO SAVEPOINT migration_attempt');
    await db.query('RELEASE SAVEPOINT migration_attempt');
    expect(await acl()).toEqual(before);
    expect(await privileges('lowwin_runtime')).toBe(true);
    expect((await db.query(`SELECT pg_has_role('anon', 'lowwin_runtime', 'MEMBER') AS member`)).rows[0].member).toBe(true);
  });
});
