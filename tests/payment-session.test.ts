import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {verifyFixtureContact} from './contact-fixtures';
import {signedLaunch,TEST_TOKEN} from './helpers';
import {requirePaymentSession} from '../src/modules/payments/session';
import {getMiniSession} from '../src/modules/auth/mini-access';
import {fundingOptions,getOwnTopup,listOwnTopups} from '../src/modules/payments/service';

const url=process.env.PAYMENT_TEST_DATABASE_URL;
describe.skipIf(!url)('payment session reauthorization on disposable PostgreSQL',()=>{
 let db:PrismaClient;
 const queries:string[]=[];
 const measurements:Record<string,{before:number;after:number}>={};
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback only');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,APP_ENV:'local',NODE_ENV:'test',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',DEV_IDENTITY_ENABLED:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  const logged=new PrismaClient({log:[{emit:'event',level:'query'}]});logged.$on('query',event=>queries.push(event.query));db=logged;
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect();mkdirSync('.local/payment-speed-review',{recursive:true});writeFileSync('.local/payment-speed-review/query-counts.json',JSON.stringify(measurements,null,2))});
 async function signIn(){
  const telegramId=randomInt(4000000000,5000000000);await verifyFixtureContact(db,telegramId);
  const {handleAuth}=await import('../src/modules/auth/handler');
  // Independent test users represent separate clients; do not exhaust the
  // shared sign-in IP quota when this suite is rerun against its disposable DB.
  const ip=`127.${(telegramId>>>16)&255}.${(telegramId>>>8)&255}.${telegramId&255}`;
  const response=await handleAuth(new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Payment session fixture'})})})}));
  expect(response.status).toBe(200);
  const headers=new Headers({cookie:response.headers.get('set-cookie')!.split(';')[0]});
  const request=new Request('http://localhost:3000/api/wallet/top-ups',{method:'POST',headers});
  const auth=await requirePaymentSession(request);
  const session=await db.session.findFirstOrThrow({where:{userId:auth.userId}});
  return {auth,session,headers};
 }
 it('validates real signed Telegram sessions with one in-transaction read',async()=>{
  const {auth,headers}=await signIn();
  queries.length=0;await db.$transaction(async tx=>{expect(await getMiniSession(headers,tx)).not.toBeNull()});
  const before=queries.filter(q=>/^SELECT/i.test(q)).length;
  queries.length=0;await db.$transaction(auth.reauthorize);
  const after=queries.filter(q=>/^SELECT/i.test(q)).length;
  expect(after).toBe(1);expect(before).toBeGreaterThan(after);
  measurements.sessionReauthorization={before,after};
  console.info(JSON.stringify({benchmark:'payment-session-db-reads',before,after}));
 });
 it.each(['expired','deleted','token','binding','contact','staff','owner','contact-bot','user-binding'] as const)('rejects %s sessions after the initial authentication',async change=>{
  const {auth,session}=await signIn();
  if(change==='expired')await db.session.update({where:{id:session.id},data:{expiresAt:new Date(0)}});
  if(change==='deleted')await db.session.delete({where:{id:session.id}});
  if(change==='token')await db.session.update({where:{id:session.id},data:{token:'rotated-'+session.id}});
  if(change==='binding')await db.session.update({where:{id:session.id},data:{telegramLaunchId:'other'}});
  if(change==='contact')await db.telegramOwnContact.update({where:{userId:auth.userId},data:{revokedAt:new Date()}});
  if(change==='staff')await db.staffMember.create({data:{userId:auth.userId,role:'OWNER',recoveryHashes:[]}});
  if(change==='owner'){const other=await db.user.create({data:{id:'other-'+session.id,name:'Other session fixture'}});await db.session.update({where:{id:session.id},data:{userId:other.id}})}
  if(change==='contact-bot')await db.telegramOwnContact.update({where:{userId:auth.userId},data:{botId:'999999'}});
  if(change==='user-binding')await db.user.update({where:{id:auth.userId},data:{telegramId:'other-'+session.id}});
  await expect(db.$transaction(auth.reauthorize)).rejects.toMatchObject({status:401});
 });
 it('rejects unsigned sessions before creating a payment authorizer',async()=>{
  await expect(requirePaymentSession(new Request('http://localhost:3000/api/wallet/top-ups',{headers:{cookie:'better-auth.session_token=forged'}}))).rejects.toMatchObject({status:401});
 });
 it('uses one bounded deposit-status query and cannot read another account',async()=>{
  const intent=await db.topUpIntent.findFirst();
  if(!intent){ // Missing IDs still exercise exactly the same bounded SELECT.
   queries.length=0;await expect(getOwnTopup(db,'not-owner','00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({status:404});
   expect(queries.filter(q=>/^SELECT/i.test(q))).toHaveLength(1);return;
  }
  queries.length=0;await fundingOptions(db);await listOwnTopups(db,intent.userId);
  const before=queries.filter(q=>/^SELECT/i.test(q)).length;
  queries.length=0;expect((await getOwnTopup(db,intent.userId,intent.id)).id).toBe(intent.id);
  const after=queries.filter(q=>/^SELECT/i.test(q)).length;
  expect(after).toBe(1);expect(before).toBeGreaterThan(after);
  measurements.depositStatusExcludingAuth={before,after};
  await expect(getOwnTopup(db,'not-owner',intent.id)).rejects.toMatchObject({status:404});
  console.info(JSON.stringify({benchmark:'deposit-poll-db-reads-excluding-auth',before,after}));
 });
});
