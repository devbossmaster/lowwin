import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {createServer,type Server} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {TEST_TOKEN} from './helpers';
const database=process.env.MASTER_ADMIN_TEST_DATABASE_URL;
describe.skipIf(!database)('Master Guide Admin on disposable PostgreSQL',()=>{
 let db:PrismaClient,sink:Server,auth:typeof import('../src/modules/auth/handler').handleAuth,requireAdmin:typeof import('../src/modules/admin/boundary').requireAdmin,cookie='',userId='';
 const messages:{to:string;text:string}[]=[];
 const origin='http://localhost:3000';
 const email=`master-${randomUUID()}@lowin.test`;
 const password='Fixture-master-password-12345';
 const request=(path:string,body?:unknown,session='')=>new Request(origin+'/api/auth/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'198.18.72.91',...(session?{cookie:session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const post=(path:string,body:unknown,session='')=>auth(request(path,body,session));
 const latestLink=()=>messages.at(-1)!.text.match(/https?:[^\s]+/)![0];
 const credentials=()=>({email,password});
 beforeAll(async()=>{
  const url=new URL(database!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  sink=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;messages.push(JSON.parse(body));res.writeHead(204);res.end()});await new Promise<void>(resolve=>sink.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',BETTER_AUTH_URL:origin,MINI_APP_URL:origin,BETTER_AUTH_SECRET:'fixture-master-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-master-webhook-secret-at-least-thirty-two',DEV_IDENTITY_ENABLED:'false',DEV_POINTS_ENABLED:'false',EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:`http://127.0.0.1:${(sink.address() as {port:number}).port}`});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});db=new PrismaClient({datasourceUrl:database});({handleAuth:auth}=await import('../src/modules/auth/handler'));({requireAdmin}=await import('../src/modules/admin/boundary'));
 },60000);
 beforeEach(async()=>{await db.rateLimit.deleteMany()});
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect();await new Promise<void>(resolve=>sink?.close(()=>resolve()))});
 it('registers a member, sends an email, and issues no session or administrator row',async()=>{
  const response=await post('sign-up/email',{...credentials(),name:'Master fixture',callbackURL:origin+'/admin/login?verified=1'});expect(response.status,await response.clone().text()).toBe(200);
  const user=await db.user.findUniqueOrThrow({where:{email}});userId=user.id;expect(user).toMatchObject({role:'member',emailVerified:false,telegramId:null});expect(response.headers.getSetCookie().some(value=>value.includes('session_token='))).toBe(false);expect(await db.staffMember.findUnique({where:{userId}})).toBeNull();expect(messages).toHaveLength(1);
 });
 it('rejects role claims and wrong origins, and retires invitation/MFA endpoints',async()=>{
  const forbidden=await post('sign-up/email',{...credentials(),email:'forged-'+email,name:'Forged',role:'admin',emailVerified:true});expect(forbidden.status).toBe(400);expect(await db.user.findUnique({where:{email:'forged-'+email}})).toBeNull();
  for(const path of ['lowin/staff/login','lowin/staff/mfa','lowin/staff/enroll','lowin/staff/accept-invite','admin/set-role'])expect((await post(path,credentials())).status).toBe(404);
  expect((await auth(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://untrusted.invalid','content-type':'application/json'},body:JSON.stringify(credentials())}))).status).toBe(403);
 });
 it('requires actual email verification and refuses a verified member sign-in',async()=>{
  expect((await post('sign-in/email',credentials())).status).toBe(403);
  const verification=new URL(latestLink());expect(verification.pathname).toBe('/api/auth/verify-email');expect((await auth(new Request(verification))).status).toBeLessThan(400);
  expect((await db.user.findUniqueOrThrow({where:{id:userId}})).emailVerified).toBe(true);
  expect((await post('sign-in/email',credentials())).status).toBe(403);expect(await db.session.count({where:{userId}})).toBe(0);
 });
 it('grants password-only access after manual database approval and marks the exact new session',async()=>{
  await db.user.update({where:{id:userId},data:{role:'admin'}});
  const response=await post('sign-in/email',{...credentials(),rememberMe:false});expect(response.status,await response.clone().text()).toBe(200);
  const body=await response.json();expect(body).not.toHaveProperty('token');cookie=response.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  const actor=await requireAdmin(db,new Headers({cookie}));expect(actor).toMatchObject({id:userId,role:'OWNER',mfaAt:null});
  const grant=await db.staffSession.findUniqueOrThrow({where:{sessionId:actor.sessionId}});expect(grant.authMethod).toBe('email-password');expect(grant.mfaAt).toBeNull();expect(grant.expiresAt.getTime()-grant.credentialAt.getTime()).toBeLessThanOrEqual(8*3600000);
  expect((await db.staffMember.findUniqueOrThrow({where:{userId}})).secret).toBeNull();
 });
 it('refuses legacy assurance records even when an account has admin role',async()=>{
  const actor=await requireAdmin(db,new Headers({cookie}));await db.staffSession.update({where:{sessionId:actor.sessionId},data:{authMethod:'legacy',mfaAt:new Date()}});await expect(requireAdmin(db,new Headers({cookie}))).rejects.toMatchObject({status:403});await db.staffSession.update({where:{sessionId:actor.sessionId},data:{authMethod:'email-password',mfaAt:null}});
 });
 it('revokes sessions immediately on role demotion, including direct API authorization',async()=>{
  await db.user.update({where:{id:userId},data:{role:'member'}});expect(await db.session.count({where:{userId}})).toBe(0);await expect(requireAdmin(db,new Headers({cookie}))).rejects.toMatchObject({status:401});await db.user.update({where:{id:userId},data:{role:'admin'}});
 });
 it('resets with a single-use Better Auth token and revokes existing sessions',async()=>{
  const login=await post('sign-in/email',credentials());expect(login.status).toBe(200);const oldCookie=login.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  expect((await post('request-password-reset',{email,redirectTo:origin+'/admin/login'})).status).toBe(200);
  const link=new URL(latestLink()),resetToken=link.pathname.split('/').at(-1)!;expect(link.pathname).toContain('/api/auth/reset-password/');
  expect((await post('reset-password',{token:resetToken,newPassword:'Fixture-replacement-password-12345'})).status).toBe(200);expect((await post('reset-password',{token:resetToken,newPassword:'Fixture-replay-password-12345'})).status).toBe(400);
  expect(await db.session.count({where:{userId}})).toBe(0);await expect(requireAdmin(db,new Headers({cookie:oldCookie}))).rejects.toMatchObject({status:401});
  expect((await post('sign-in/email',{email,password:'Fixture-replacement-password-12345'})).status).toBe(200);
 });
 it('logs out and revokes the issued server session',async()=>{
  const response=await post('sign-in/email',{email,password:'Fixture-replacement-password-12345'});const active=response.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  expect((await post('sign-out',{},active)).status).toBe(200);await expect(requireAdmin(db,new Headers({cookie:active}))).rejects.toMatchObject({status:401});
 });
});
