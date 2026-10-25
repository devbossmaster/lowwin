import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {Client} from 'pg';

const sourceUrl = process.env.TEST_DATABASE_URL;
const migrationsRoot = new URL('../prisma/migrations/', import.meta.url);
const migrationSql = readdirSync(migrationsRoot, {withFileTypes: true})
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  .map(name => readFileSync(new URL(`${name}/migration.sql`, migrationsRoot), 'utf8'));
const runtimeSql = readFileSync(new URL('../deploy/runtime-role.sql', import.meta.url), 'utf8');
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const immutableTables = ['AuctionFeeRevision', 'AuctionControlRevision', 'PaymentTransferAlias', 'AdminWalletCredit'];
const mutableTables = ['VerifyRequest', 'VerifyWebhookEvent', 'ArifPayCheckout'];
const testTables = ['TestRun', 'TestRunActor', 'TelegramMessage'];

describe.skipIf(!sourceUrl)('runtime role provisioning on disposable PostgreSQL', () => {
  let databaseUrl: string, db: Client;
  let roles: {runtime: string; anon: string; authenticated: string};
  const run = randomUUID().replaceAll('-', '').slice(0, 12);
  // Only in-memory SQL copies are adapted. Transaction wrappers are replaced
  // with one outer test transaction so cluster-wide fixture roles and every
  // migration side effect roll back together. Applied source files stay intact.
  const isolated = (sql: string) => sql
    .replace(/\blowwin_runtime\b/g, roles.runtime)
    .replace(/\banon\b/g, roles.anon)
    .replace(/\bauthenticated\b/g, roles.authenticated)
    .replace(/^[\t ]*(?:BEGIN|COMMIT);[\t ]*\r?$/gm, '');
  const runtimeExists = async () => (await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [roles.runtime])).rowCount !== 0;
  const provision = () => db.query(isolated(runtimeSql));
  const functionAccess = async (role: string) => (await db.query<{allowed: boolean}>(
    `SELECT has_function_privilege($1, 'public.cleanup_test_run(text)', 'EXECUTE') AS allowed`, [role],
  )).rows[0].allowed;
  const privilege = async (table: string, verb: string) => (await db.query<{allowed: boolean}>(
    'SELECT has_table_privilege($1, $2, $3) AS allowed', [roles.runtime, `public.${quote(table)}`, verb],
  )).rows[0].allowed;
  async function asRole(role: string, sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT role_command');
    try {
      await db.query(`SET LOCAL ROLE ${quote(role)}`);
      return await db.query(sql, params);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT role_command');
      await db.query('RELEASE SAVEPOINT role_command');
    }
  }
  async function snapshot() {
    return {
      role: (await db.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1`, [roles.runtime])).rows,
      relations: (await db.query(`SELECT c.relname, c.relrowsecurity, c.relowner, c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','S') ORDER BY c.relname`)).rows,
      policies: (await db.query(`SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,
      schema: (await db.query(`SELECT nspacl::text FROM pg_namespace WHERE nspname='public'`)).rows,
      function: (await db.query(`SELECT proacl::text FROM pg_proc WHERE oid='public.cleanup_test_run(text)'::regprocedure`)).rows,
    };
  }
  async function migrate(groupFirst = false) {
    await db.query(`CREATE ROLE ${quote(roles.anon)} NOLOGIN; CREATE ROLE ${quote(roles.authenticated)} NOLOGIN`);
    if (groupFirst) {
      await db.query(`CREATE ROLE ${quote(roles.runtime)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    expect(await runtimeExists()).toBe(groupFirst);
    // Reproduce Supabase's direct function grants without touching its real
    // browser roles or this workstation's existing runtime group.
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${quote(roles.anon)}, ${quote(roles.authenticated)}`);
    // Prisma creates its metadata table separately from migration.sql files.
    await db.query(`CREATE TABLE public."_prisma_migrations" (
      id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
      finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text,
      rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(),
      applied_steps_count integer NOT NULL DEFAULT 0
    )`);
    for (const sql of migrationSql) await db.query(isolated(sql));
    expect(await runtimeExists()).toBe(groupFirst);
  }
  async function verifyRuntimeAccess() {
    expect((await db.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1`, [roles.runtime])).rows[0])
      .toEqual({rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false});
    for (const table of [...testTables, ...mutableTables, ...immutableTables]) {
      const expected = testTables.includes(table) ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] : mutableTables.includes(table) ? ['SELECT', 'INSERT', 'UPDATE'] : ['SELECT', 'INSERT'];
      for (const verb of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(await privilege(table, verb), `${table} ${verb}`).toBe(expected.includes(verb));
      }
      const policy = (await db.query(`SELECT p.roles::text[] AS roles,p.cmd,p.qual,p.with_check,c.relrowsecurity FROM pg_policies p JOIN pg_class c ON c.relname=p.tablename JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname=p.schemaname WHERE p.schemaname='public' AND p.tablename=$1 AND p.policyname='lowwin_server_access'`, [table])).rows;
      expect(policy).toHaveLength(1);
      expect(policy[0]).toEqual({roles: [roles.runtime], cmd: 'ALL', qual: 'true', with_check: 'true', relrowsecurity: true});
      await asRole(roles.runtime, `SELECT * FROM public.${quote(table)} LIMIT 0`);
    }
    await asRole(roles.runtime, `INSERT INTO public."TestRun" (id,state,label,"actorId","updatedAt") VALUES ($1,'DRAFT','Disposable runtime fixture','fixture-owner',CURRENT_TIMESTAMP)`, [`runtime-${run}`]);
    // No real cleanup is attempted; an empty, ineligible run still reaches the
    // historical guard for the server role, while browser calls are denied.
    expect(await functionAccess(roles.runtime)).toBe(true);
    await expect(asRole(roles.runtime, 'SELECT public.cleanup_test_run($1::text)', ['not-an-existing-test-run']))
      .rejects.toMatchObject({code: 'P0001', message: 'Eligible finished test run required'});
    for (const role of [roles.anon, roles.authenticated]) {
      expect(await functionAccess(role)).toBe(false);
    }
    expect((await db.query(`SELECT count(*)::int AS count FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='public.cleanup_test_run(text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].count).toBe(0);
    for (const table of ['ArifPayCheckout', ...immutableTables]) {
      await expect(asRole(roles.runtime, `DELETE FROM public.${quote(table)} WHERE false`)).rejects.toMatchObject({code: '42501'});
      await expect(asRole(roles.runtime, `TRUNCATE public.${quote(table)}`)).rejects.toMatchObject({code: '42501'});
    }
    await expect(asRole(roles.runtime, 'SELECT * FROM public."_prisma_migrations"')).rejects.toMatchObject({code: '42501'});
    expect((await db.query(`SELECT has_schema_privilege($1,'public','CREATE') AS create`, [roles.runtime])).rows[0].create).toBe(false);
  }

  beforeAll(async () => {
    const base = new URL(sourceUrl!);
    if (!['127.0.0.1', 'localhost'].includes(base.hostname) || !base.pathname.endsWith('_test')) {
      throw Error('Explicit disposable loopback TEST_DATABASE_URL ending in _test required');
    }
    const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
    const admin = new Client({connectionString: adminUrl.href, connectionTimeoutMillis: 5000});
    await admin.connect();
    try {
      const name = `lowwin_runtime_provision_${run}_test`;
      await admin.query(`CREATE DATABASE ${quote(name)}`);
      base.pathname = `/${name}`; databaseUrl = base.href;
    } finally { await admin.end(); }
  }, 30000);
  beforeEach(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    roles = {runtime: `runtime_fixture_${suffix}`, anon: `anon_fixture_${suffix}`, authenticated: `auth_fixture_${suffix}`};
    db = new Client({connectionString: databaseUrl, connectionTimeoutMillis: 5000});
    await db.connect(); await db.query('BEGIN');
    await db.query(`SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'`);
  });
  afterEach(async () => {
    if (db) {
      try {
        await db.query('ROLLBACK');
        expect((await db.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [Object.values(roles)])).rows).toEqual([]);
      } finally { await db.end(); }
    }
  });

  it.each([false, true])('provisions complete least-privilege access with group-first=%s and remains idempotent', async groupFirst => {
    await migrate(groupFirst);
    // The deployment script repairs independently retained direct browser ACLs
    // as well as a role created only after all migrations have finished.
    await db.query(`GRANT EXECUTE ON FUNCTION public.cleanup_test_run(text) TO PUBLIC, ${quote(roles.anon)}, ${quote(roles.authenticated)}`);
    await provision();
    await verifyRuntimeAccess();
    const first = await snapshot();
    await provision();
    expect(await snapshot()).toEqual(first);
  }, 60000);

  it.each(['LOGIN', 'REPLICATION'])('rejects a pre-existing %s runtime group without partial permission changes', async flag => {
    await migrate();
    await db.query(`CREATE ROLE ${quote(roles.runtime)} ${flag === 'LOGIN' ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE ${flag === 'REPLICATION' ? 'REPLICATION' : 'NOREPLICATION'} NOBYPASSRLS`);
    const before = await snapshot();
    await db.query('SAVEPOINT provisioning');
    await expect(provision()).rejects.toMatchObject({code: 'P0001', message: `Unsafe pre-existing ${roles.runtime} role`});
    await db.query('ROLLBACK TO SAVEPOINT provisioning');
    expect(await snapshot()).toEqual(before);
    expect(await privilege('TestRun', 'SELECT')).toBe(false);
  }, 60000);

  it('rolls back earlier grants when inherited browser cleanup access prevents safe provisioning', async () => {
    await migrate(true);
    await db.query(`GRANT ${quote(roles.runtime)} TO ${quote(roles.anon)}`);
    const before = await snapshot();
    expect(await privilege('TestRun', 'SELECT')).toBe(true); // migration's grant
    expect(await privilege('Wallet', 'SELECT')).toBe(false); // script has not run
    await db.query('SAVEPOINT provisioning');
    await expect(provision()).rejects.toMatchObject({code: '42501', message: 'Browser role still has privileged cleanup access'});
    await db.query('ROLLBACK TO SAVEPOINT provisioning');
    expect(await snapshot()).toEqual(before);
    expect(await privilege('Wallet', 'SELECT')).toBe(false);
    expect((await db.query('SELECT pg_has_role($1,$2,\'MEMBER\') AS member', [roles.anon, roles.runtime])).rows[0].member).toBe(true);
  }, 60000);
});
