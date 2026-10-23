import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';

const adapter = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), disconnect: vi.fn(),
  constructed: [] as unknown[],
}));
// Import the actual CLI while replacing only dotenv loading and its transport.
// The transport below executes real SQL against the guarded local transaction.
vi.mock('dotenv/config', () => ({}));
vi.mock('@prisma/client', () => ({PrismaClient: class {
  constructor(options: unknown) { adapter.constructed.push(options); }
  $queryRawUnsafe(sql: string, ...values: unknown[]) { return adapter.query(sql, ...values); }
  $executeRawUnsafe(sql: string, ...values: unknown[]) { return adapter.execute(sql, ...values); }
  $disconnect() { return adapter.disconnect(); }
}}));

const url = process.env.TEST_DATABASE_URL;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const password = () => `local_fixture_password_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!url)('runtime login CLI with a non-superuser CREATEROLE connection', () => {
  let db: Client;
  let roles: {runtime: string; app: string; provisioner: string};
  let previousExitCode: typeof process.exitCode;
  let initialPassword: string;
  const translate = (sql: string) => sql.replace(/\blowwin_runtime\b/g, roles.runtime).replace(/\blowwin_app\b/g, roles.app);
  const value = (input: unknown) => input === 'lowwin_runtime' ? roles.runtime : input === 'lowwin_app' ? roles.app : input;
  async function asOwner<T>(work: () => Promise<T>) {
    await db.query('RESET ROLE');
    try { return await work(); }
    finally { await db.query(`SET LOCAL ROLE ${quote(roles.provisioner)}`); }
  }
  const storedRole = () => asOwner(async () => (await db.query(`
    SELECT rolname::text,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolpassword
    FROM pg_authid WHERE rolname=$1
  `, [roles.app])).rows[0]);
  async function run(nextPassword = password()) {
    process.exitCode = undefined;
    vi.stubEnv('MIGRATION_DIRECT_URL', url!);
    vi.stubEnv('LOWWIN_APP_PASSWORD', nextPassword);
    vi.resetModules();
    await import('../scripts/create-runtime-login');
  }
  function diagnostic(stage: string, code = 'UNKNOWN') {
    expect(console.error).toHaveBeenCalledTimes(1);
    const [output] = vi.mocked(console.error).mock.calls[0];
    const parsed = JSON.parse(String(output));
    expect(parsed).toMatchObject({event: 'runtime_login_failed', stage, code});
    expect(Object.keys(parsed).every(key => ['event', 'stage', 'code', 'kind', 'sqlState', 'reason', 'hint'].includes(key))).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    return parsed;
  }

  beforeEach(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
      throw Error('Explicit disposable loopback TEST_DATABASE_URL ending in _test required');
    }
    previousExitCode = process.exitCode;
    vi.resetAllMocks(); adapter.constructed.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    roles = {runtime: `login_runtime_${suffix}`, app: `login_app_${suffix}`, provisioner: `login_owner_${suffix}`};
    initialPassword = password();
    db = new Client({connectionString: url, connectionTimeoutMillis: 5000});
    await db.connect(); await db.query('BEGIN');
    await db.query(`SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'`);
    await db.query(`CREATE ROLE ${quote(roles.runtime)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await db.query(`CREATE ROLE ${quote(roles.provisioner)} NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS`);
    await db.query(`GRANT ${quote(roles.runtime)} TO ${quote(roles.provisioner)} WITH ADMIN OPTION`);
    await db.query(`SET LOCAL ROLE ${quote(roles.provisioner)}`);
    expect((await db.query(`SELECT current_user::text AS name,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`)).rows[0])
      .toEqual({name: roles.provisioner, rolsuper: false, rolcreaterole: true});
    adapter.query.mockImplementation(async (sql: string, ...values: unknown[]) => (await db.query(translate(sql), values.map(value))).rows);
    adapter.execute.mockImplementation(async (sql: string, ...values: unknown[]) => (await db.query(translate(sql), values.map(value))).rowCount ?? 0);
    // Keep ownership of the real connection in the test's outer transaction.
    adapter.disconnect.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    try {
      if (db) {
        await db.query('ROLLBACK');
        expect((await db.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [Object.values(roles)])).rows).toEqual([]);
      }
    } finally {
      await db?.end();
      process.exitCode = previousExitCode;
      vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules();
    }
  });

  it('creates a restricted login, then rotates its password without privileged ALTER attributes', async () => {
    await run(initialPassword);
    expect(process.exitCode).toBeUndefined(); expect(console.error).not.toHaveBeenCalled();
    expect(adapter.constructed).toEqual([{datasourceUrl: url}]);
    const created = await storedRole();
    expect(created).toMatchObject({rolname: roles.app, rolcanlogin: true, rolinherit: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false});
    expect(created.rolpassword).toMatch(/^SCRAM-SHA-256\$/);
    expect((await db.query('SELECT pg_has_role($1,$2,\'MEMBER\') AS member', [roles.app, roles.runtime])).rows[0].member).toBe(true);
    const firstStatement = adapter.execute.mock.calls[0][0] as string;
    expect(firstStatement).toContain('CREATE ROLE "lowwin_app" WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');

    adapter.execute.mockClear(); vi.mocked(console.log).mockClear();
    const nextPassword = password();
    await run(nextPassword);
    expect(process.exitCode).toBeUndefined(); expect(console.error).not.toHaveBeenCalled();
    const rotated = await storedRole();
    expect(rotated.rolpassword).not.toBe(created.rolpassword);
    expect({...rotated, rolpassword: null}).toEqual({...created, rolpassword: null});
    expect(adapter.execute.mock.calls[0][0]).toBe(`ALTER ROLE "lowwin_app" WITH LOGIN INHERIT PASSWORD '${nextPassword}'`);
    expect(adapter.disconnect).toHaveBeenCalledTimes(2);
  });

  it('compares the former full ALTER under the same non-superuser without retaining a password change', async () => {
    await run(initialPassword);
    expect(process.exitCode).toBeUndefined();
    const before = await storedRole();
    await db.query('SAVEPOINT old_alter');
    let outcome = 'SUCCESS';
    try {
      await db.query(`ALTER ROLE ${quote(roles.app)} WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password()}'`);
    } catch (error) { outcome = String((error as {code?: string}).code ?? 'UNKNOWN'); }
    await db.query('ROLLBACK TO SAVEPOINT old_alter');
    expect(await storedRole()).toEqual(before);
    // PostgreSQL versions/platform role rules can differ. Record the observed
    // local result; this is not evidence of a hosted database's failure cause.
    expect(['SUCCESS', '42501']).toContain(outcome);
    console.info(`Local non-superuser former ALTER outcome: ${outcome}`);
  });

  it.each(['SUPERUSER', 'CREATEDB', 'CREATEROLE', 'REPLICATION', 'BYPASSRLS'])('rejects an existing %s login before mutating its password or memberships', async flag => {
    await asOwner(() => db.query(`CREATE ROLE ${quote(roles.app)} LOGIN ${flag} PASSWORD '${initialPassword}'`));
    const before = await storedRole();
    await run();
    diagnostic('login-read');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(await storedRole()).toEqual(before);
    expect(adapter.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects an unsafe runtime group before creating a login', async () => {
    await asOwner(() => db.query(`ALTER ROLE ${quote(roles.runtime)} LOGIN`));
    await run();
    diagnostic('group-read');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(await storedRole()).toBeUndefined();
  });

  it('reports a fixed stage and safe database codes without connection strings, SQL or passwords', async () => {
    const privateDetails = 'postgresql://private-user:private-password@private-db.example/private_db';
    adapter.execute.mockRejectedValueOnce({
      name: 'PrismaClientKnownRequestError', code: 'P2010',
      message: `ALTER ROLE private-role PASSWORD private-secret; ${privateDetails}`,
      meta: {code: '42501', message: 'private-transaction-details'},
    });
    await run();
    expect(diagnostic('create-or-rotate', 'P2010')).toMatchObject({sqlState: '42501', kind: 'PrismaClientKnownRequestError'});
    const output = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(output).not.toMatch(/private-user|private-password|private-db|private_db|private-role|private-secret|private-transaction|ALTER ROLE|postgresql/);
    expect(await storedRole()).toBeUndefined();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
  });

  it('handles invalid connection configuration without constructing a client or leaking its value', async () => {
    vi.stubEnv('MIGRATION_DIRECT_URL', 'postgresql://private-user:private-password@[');
    vi.stubEnv('LOWWIN_APP_PASSWORD', initialPassword);
    process.exitCode = undefined; vi.resetModules();
    await import('../scripts/create-runtime-login');
    diagnostic('group-read');
    expect(adapter.constructed).toEqual([]);
    expect(adapter.query).not.toHaveBeenCalled(); expect(adapter.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-user|private-password|postgresql/);
  });
});
