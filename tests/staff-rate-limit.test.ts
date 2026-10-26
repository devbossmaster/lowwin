import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {digest} from '../src/modules/admin/crypto';
const f=vi.hoisted(()=>({session:vi.fn()}));
vi.mock('../src/modules/auth/server',()=>({createAuth:()=>({api:{getSession:f.session}})}));
import {staffRateLimit} from '../src/modules/admin/rate-limit';
const database=process.env.TEST_DATABASE_URL;
const request=(email:string,cookie='fixture-cookie')=>new Request('http://localhost/api/auth/lowin/staff/login',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({email,password:'fixture-password-only'})});
describe.skipIf(!database)('atomic database staff fixed-window limiter',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{
  const target=new URL(database!);
  if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Staff rate-limit tests require a disposable loopback _test database');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});await db.$connect();
 },60000);
 beforeEach(()=>{vi.clearAllMocks();f.session.mockReset().mockResolvedValue(null)});afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await db?.$disconnect()});
 it('accepts exactly12 concurrent login attempts without losing increments or needing an interactive transaction',async()=>{const email=`concurrency-${randomUUID()}@example.invalid`,answers=await Promise.all(Array.from({length:48},()=>staffRateLimit(db,'login',request(email))));expect(answers.filter(Boolean)).toHaveLength(12);const row=await db.rateLimit.findUniqueOrThrow({where:{key:`staff:login:${digest(email)}`}});expect(row.count).toBe(48);expect(f.session).not.toHaveBeenCalled()});
 it('keeps the stricter5-attempt forgot threshold under concurrency',async()=>{const email=`forgot-${randomUUID()}@example.invalid`,answers=await Promise.all(Array.from({length:20},()=>staffRateLimit(db,'forgot',request(email))));expect(answers.filter(Boolean)).toHaveLength(5);expect((await db.rateLimit.findUniqueOrThrow({where:{key:`staff:forgot:${digest(email)}`}})).count).toBe(20)});
 it('retains a fixed window start and resets at the15-minute boundary without extending a window for denied requests',async()=>{const email=`window-${randomUUID()}@example.invalid`,key=`staff:login:${digest(email)}`;await staffRateLimit(db,'login',request(email));const first=await db.rateLimit.findUniqueOrThrow({where:{key}});await db.rateLimit.update({where:{key},data:{count:12}});expect(await staffRateLimit(db,'login',request(email))).toBe(false);expect(await db.rateLimit.findUniqueOrThrow({where:{key}})).toMatchObject({count:13,lastRequest:first.lastRequest});await db.rateLimit.update({where:{key},data:{lastRequest:first.lastRequest-900000n}});expect(await staffRateLimit(db,'login',request(email))).toBe(true);const reset=await db.rateLimit.findUniqueOrThrow({where:{key}});expect(reset.count).toBe(1);expect(reset.lastRequest).toBeGreaterThan(first.lastRequest-900000n)});
 it('normalizes email identity regardless of cookie changes',async()=>{const email=`normal-${randomUUID()}@example.invalid`;await staffRateLimit(db,'login',request('  '+email.toUpperCase()+'  ','rotated-one'));await staffRateLimit(db,'login',request(email,'rotated-two'));expect((await db.rateLimit.findUniqueOrThrow({where:{key:`staff:login:${digest(email)}`}})).count).toBe(2)});
 it('uses the verified MFA account instead of supplied emails or arbitrary cookies',async()=>{const userId='verified-'+randomUUID();f.session.mockResolvedValue({user:{id:userId}});const answers=await Promise.all(Array.from({length:15},(_,index)=>staffRateLimit(db,'mfa',request(`forged-${index}@example.invalid`,'rotated-'+index))));expect(answers.filter(Boolean)).toHaveLength(12);expect((await db.rateLimit.findUniqueOrThrow({where:{key:`staff:mfa:${digest('user:'+userId)}`}})).count).toBe(15);expect(f.session).toHaveBeenCalledTimes(15)});
 it('takes window timestamps from PostgreSQL even when application time differs',async()=>{const email=`db-clock-${randomUUID()}@example.invalid`;vi.spyOn(Date,'now').mockReturnValue(0);await staffRateLimit(db,'login',request(email));const row=await db.rateLimit.findUniqueOrThrow({where:{key:`staff:login:${digest(email)}`}}),[{now}]=await db.$queryRaw<{now:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`;expect(row.lastRequest).toBeGreaterThan(0n);expect(now-row.lastRequest).toBeGreaterThanOrEqual(0n);expect(now-row.lastRequest).toBeLessThan(5000n)});
});
