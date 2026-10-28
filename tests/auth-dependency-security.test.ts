import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {TEST_TOKEN} from './helpers';

const database=process.env.TEST_DATABASE_URL;

describe.skipIf(!database)('installed authentication advisory boundaries on PostgreSQL',()=>{
 let db:PrismaClient,auth:ReturnType<typeof import('../src/modules/auth/server').createAuth>;
 const origin='http://localhost:3027';
 const request=(path:string,body?:unknown)=>new Request(origin+'/api/auth/'+path,{
  method:body===undefined?'GET':'POST',
  headers:{origin,'content-type':'application/json','x-forwarded-for':'198.18.73.11'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
 });
 beforeAll(async()=>{
  const url=new URL(database!);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',
   BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'fixture-security-secret-at-least-thirty-two-characters',
   TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-security-webhook-secret-thirty-two',
   DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database});
  const {createAuth}=await import('../src/modules/auth/server');auth=createAuth(db);
 },60_000);
 beforeEach(async()=>{await db.rateLimit.deleteMany()});
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});

 it('does not register the vulnerable optional Magic Link, OAuth Proxy or device-approval flows',async()=>{
  for(const [path,body] of [
   ['sign-in/magic-link',{email:'fixture@example.invalid'}],
   ['magic-link/verify',undefined],
   ['oauth-proxy-callback',undefined],
   ['device/code',{}],
   ['device/approve',{userCode:'TEST-CODE'}],
  ] as const){
   const response=await auth.handler(request(path,body));
   expect(response.status,path).toBe(404);
   expect(response.headers.getSetCookie().some(value=>value.includes('session_token='))).toBe(false);
  }
 });

 it('enforces the configured password limit during concurrent database-backed requests',async()=>{
  // Invalid bodies exercise the request limiter without password hashing,
  // account creation, email delivery or any provider request.
  const sessionsBefore=await db.session.count();
  const responses=await Promise.all(Array.from({length:24},()=>auth.handler(request('sign-in/email',{}))));
  expect(responses.filter(response=>response.status===400)).toHaveLength(5);
  expect(responses.filter(response=>response.status===429)).toHaveLength(19);
  for(const response of responses.filter(response=>response.status===429))expect(Number(response.headers.get('x-retry-after')??response.headers.get('retry-after'))).toBeGreaterThan(0);
  const rows=await db.rateLimit.findMany();
  expect(rows).toHaveLength(1);expect(rows[0].count).toBe(5);
  expect(await db.session.count()).toBe(sessionsBefore);
 });
});
