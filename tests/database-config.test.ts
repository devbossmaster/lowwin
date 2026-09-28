import {afterEach,describe,expect,it,vi} from 'vitest';
import {runtimeDatabaseUrl} from '../src/lib/database-config';

const fixtures=vi.hoisted(()=>({created:[] as Array<{options:unknown;$disconnect:ReturnType<typeof vi.fn>}>}));
vi.mock('@prisma/client',()=>({PrismaClient:class {
  $disconnect=vi.fn(async()=>{});
  constructor(public options:unknown){fixtures.created.push(this)}
}}));
const cache=globalThis as unknown as {lowinDb?:unknown;lowinDbConfigKey?:string};
afterEach(()=>{delete cache.lowinDb;delete cache.lowinDbConfigKey;fixtures.created.length=0;vi.unstubAllEnvs();vi.resetModules()});

describe('runtime database configuration',()=>{
  it('adds bounded Supabase defaults and transaction-pool compatibility',()=>{
    const url=new URL(runtimeDatabaseUrl('postgresql://user:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require')!);
    expect(Object.fromEntries(url.searchParams)).toEqual({sslmode:'require',connect_timeout:'15',pool_timeout:'20',connection_limit:'5',pgbouncer:'true'});
    expect(url.password).toBe('secret');expect(url.port).toBe('6543');
  });
  it('preserves explicit tuning and session mode without changing destinations',()=>{
    const url=new URL(runtimeDatabaseUrl('postgresql://user:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?connect_timeout=20&connection_limit=1&pool_timeout=8')!);
    expect(url.port).toBe('5432');expect(url.searchParams.get('pgbouncer')).toBeNull();
    expect(url.searchParams.get('connect_timeout')).toBe('20');expect(url.searchParams.get('connection_limit')).toBe('1');expect(url.searchParams.get('pool_timeout')).toBe('8');
  });
  it('leaves local and other providers unchanged, and allows lazy build initialization',()=>{
    for(const raw of ['postgresql://user:secret@127.0.0.1:55441/local_test','postgresql://user:secret@db.example.com:5432/app'])expect(runtimeDatabaseUrl(raw)).toBe(raw);
    expect(runtimeDatabaseUrl(undefined)).toBeUndefined();
    expect(()=>runtimeDatabaseUrl('private-invalid-value')).toThrow('DATABASE_URL is invalid');
  });
  it('reuses the development pool for identical settings',async()=>{
    vi.stubEnv('NODE_ENV','development');vi.stubEnv('DATABASE_URL','postgresql://user:secret@localhost:5432/app');
    const first=(await import('../src/lib/db')).db;vi.resetModules();
    expect((await import('../src/lib/db')).db).toBe(first);
    expect(fixtures.created).toHaveLength(1);expect(fixtures.created[0].$disconnect).not.toHaveBeenCalled();
  });
  it('replaces and closes a stale development pool when connection settings change',async()=>{
    vi.stubEnv('NODE_ENV','development');vi.stubEnv('DATABASE_URL','postgresql://user:old@localhost:5432/app');
    const first=(await import('../src/lib/db')).db;vi.resetModules();
    const updated='postgresql://user:new@localhost:6543/app?connect_timeout=15';vi.stubEnv('DATABASE_URL',updated);
    const second=(await import('../src/lib/db')).db;
    expect(second).not.toBe(first);expect(fixtures.created[0].$disconnect).toHaveBeenCalledOnce();
    expect(fixtures.created[1].options).toEqual({datasourceUrl:updated});
    expect(cache.lowinDbConfigKey).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not reuse a legacy cached client with unknown settings',async()=>{
    vi.stubEnv('NODE_ENV','development');const old={$disconnect:vi.fn(async()=>{})};cache.lowinDb=old;
    expect((await import('../src/lib/db')).db).not.toBe(old);expect(old.$disconnect).toHaveBeenCalledOnce();
  });
});
