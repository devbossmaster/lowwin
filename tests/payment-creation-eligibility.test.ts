import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyFixtureContact} from './contact-fixtures';
import {signedLaunch,TEST_TOKEN} from './helpers';
import {requirePaymentSession} from '../src/modules/payments/session';
import {eligible} from '../src/modules/payments/chapa';
import {createCurrentDirectCheckout} from '../src/modules/payments/chapa-inline';
import type {ChapaTransport} from '../src/modules/payments/chapa-provider';

const database=process.env.PAYMENT_TEST_DATABASE_URL;
describe.skipIf(!database)('creation-only fresh payment authorization on isolated PostgreSQL',()=>{
 let db:PrismaClient,capture:string[]|null=null;
 beforeAll(async()=>{
  const target=new URL(database!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,APP_ENV:'local',NODE_ENV:'test',BETTER_AUTH_URL:'https://localhost:3000',MINI_APP_URL:'https://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-only-webhook-secret-thirty-two',DEV_IDENTITY_ENABLED:'false',PHONE_CONTACT_KEY_ID:'creation-test',PHONE_CONTACT_KEYS:JSON.stringify({'creation-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),PAYMENTS_LIVE_ENABLED:'false',CHAPA_ENABLED:'true',CHAPA_MODE:'test',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_PUBLIC_KEY:'',CHAPA_WEBHOOK_SECRET:'c'.repeat(64),CHAPA_SCHEMA_READY:'true',CHAPA_INLINE_ENABLED:'false',CHAPA_RECOVERY_ENABLED:'true',CHAPA_WEBHOOK_SIGNATURE_PROFILE:'raw_body',PAYMENT_GATEWAY:'CHAPA',REDIS_URL:''});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:database,log:[{level:'query',emit:'event'}]});(db as PrismaClient<Prisma.PrismaClientOptions,'query'>).$on('query',event=>capture?.push(event.query));await db.$connect();
 },60000);
 afterAll(async()=>{await db?.$disconnect();await(await import('../src/lib/db')).db.$disconnect()});
 async function fixture(source:'MINI_APP'|'TELEGRAM_OIDC'='MINI_APP'){
  const telegramId=randomInt(4000000000,5000000000);await verifyFixtureContact(db,telegramId);const {handleAuth}=await import('../src/modules/auth/handler');
  const ip=`127.${(telegramId>>>16)&255}.${(telegramId>>>8)&255}.${telegramId&255}`;
  const response=await handleAuth(new Request('https://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'https://localhost:3000','content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:telegramId,first_name:'Creation guard fixture'})})})}));expect(response.status).toBe(200);
  const headers=new Headers({cookie:response.headers.get('set-cookie')!.split(';')[0]}),user=await db.user.findUniqueOrThrow({where:{telegramId:String(telegramId)}});
  if(source!=='MINI_APP')await db.session.updateMany({where:{userId:user.id},data:{telegramAuthSource:source}});
  const auth=await requirePaymentSession(new Request('https://localhost:3000/api/payments/chapa/direct/current',{method:'POST',headers})),session=await db.session.findFirstOrThrow({where:{userId:auth.userId}}),contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:auth.userId}}),key=randomUUID();
  expect(auth.reauthorize.forCurrentDirectCreate).toEqual(expect.any(Function));
  const authorize=(tx:Prisma.TransactionClient,userId=auth.userId,checkoutKey=key)=>auth.reauthorize.forCurrentDirectCreate!(tx,userId,checkoutKey);
  return {auth,session,contact,key,userId:auth.userId,authorize,check:()=>db.$transaction(tx=>authorize(tx))};
 }
 it.each(['MINI_APP','TELEGRAM_OIDC'] as const)('accepts the current signed/contact-bound %s identity in one creation statement',async source=>{
  const f=await fixture(source),queries:string[]=[];capture=queries;let result;try{result=await f.check()}finally{capture=null}
  expect(result).toEqual({phoneCipher:f.contact.phoneCipher,botId:f.contact.botId,replayExists:false});expect(queries.filter(sql=>/^\s*SELECT\b/i.test(sql))).toHaveLength(1);expect(queries.join('\n')).toContain('EXISTS');
 });
 it.each(['expired','deleted','token','owner','launch','source','user-binding','contact-revoked','contact-bot','contact-telegram','member-role','missing-contact','staff-active','staff-inactive'] as const)('rejects a fresh %s change made after outer authentication',async change=>{
  const f=await fixture();
  if(change==='expired')await db.session.update({where:{id:f.session.id},data:{expiresAt:new Date(0)}});
  if(change==='deleted')await db.session.delete({where:{id:f.session.id}});
  if(change==='token')await db.session.update({where:{id:f.session.id},data:{token:'rotated-'+randomUUID()}});
  if(change==='owner'){const other=await db.user.create({data:{id:randomUUID(),name:'Other fixture'}});await db.session.update({where:{id:f.session.id},data:{userId:other.id}})}
  if(change==='launch')await db.session.update({where:{id:f.session.id},data:{telegramLaunchId:'other-identity'}});
  if(change==='source')await db.session.update({where:{id:f.session.id},data:{telegramAuthSource:'TELEGRAM_OIDC'}});
  if(change==='user-binding')await db.user.update({where:{id:f.userId},data:{telegramId:'other-'+randomUUID()}});
  if(change==='contact-revoked')await db.telegramOwnContact.update({where:{userId:f.userId},data:{revokedAt:new Date()}});
  if(change==='contact-bot')await db.telegramOwnContact.update({where:{userId:f.userId},data:{botId:'987654321'}});
  if(change==='contact-telegram')await db.telegramOwnContact.update({where:{userId:f.userId},data:{telegramId:'other-'+randomUUID()}});
  if(change==='member-role')await db.user.update({where:{id:f.userId},data:{role:'admin'}});
  if(change==='missing-contact')await db.telegramOwnContact.delete({where:{userId:f.userId}});
  if(change.startsWith('staff-'))await db.staffMember.create({data:{userId:f.userId,active:change==='staff-active',recoveryHashes:[]}});
  await expect(f.check()).rejects.toMatchObject({status:401});
 });
 it('keeps creation restrictions out of original-payment reauthorization and accepts an explicitly lifted suspension',async()=>{
  const f=await fixture();await db.userRestriction.create({data:{userId:f.userId,suspended:true,reason:'Isolated creation restriction'}});
  await expect(db.$transaction(f.auth.reauthorize)).resolves.toBeUndefined();await expect(f.check()).rejects.toMatchObject({status:403,code:'BIDDING_RESTRICTED'});
  await db.userRestriction.update({where:{userId:f.userId},data:{suspended:false}});await expect(f.check()).resolves.toMatchObject({replayExists:false});
 });
 it('still requires an encrypted contact for creation without altering historical callback requirements',async()=>{
  const f=await fixture();await db.telegramOwnContact.update({where:{userId:f.userId},data:{phoneCipher:''}});
  await expect(db.$transaction(f.auth.reauthorize)).resolves.toBeUndefined();await expect(f.check()).rejects.toThrow('CONTACT_REQUIRED');
 });
 it('cannot reuse a valid creation check after role or contact changes in the same transaction',async()=>{
  for(const change of ['role','contact']){const f=await fixture();await db.$transaction(async tx=>{await f.authorize(tx);if(change==='role')await db.user.update({where:{id:f.userId},data:{role:'admin'}});else await db.telegramOwnContact.update({where:{userId:f.userId},data:{revokedAt:new Date()}});await expect(f.authorize(tx)).rejects.toMatchObject({status:401})})}
 });
 it('rejects a different supplied owner before reading any session or checkout',async()=>{
  const f=await fixture(),queries:string[]=[];capture=queries;try{await expect(db.$transaction(tx=>f.authorize(tx,randomUUID()))).rejects.toMatchObject({status:401})}finally{capture=null}expect(queries.filter(sql=>/^\s*SELECT\b/i.test(sql))).toEqual([]);
 });
 it('takes expiry from the UTC database clock independently of transaction timezone and application Date.now',async()=>{
  const f=await fixture();vi.spyOn(Date,'now').mockReturnValue(0);
  try{await expect(db.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`;return f.authorize(tx)})).resolves.toMatchObject({replayExists:false});await db.session.update({where:{id:f.session.id},data:{expiresAt:new Date(0)}});await expect(f.check()).rejects.toMatchObject({status:401})}finally{vi.restoreAllMocks()}
 });
 it('retains the current contact-bot guard even if configuration rotates after authentication',async()=>{
  const f=await fixture(),before=process.env.TELEGRAM_BOT_TOKEN;try{process.env.TELEGRAM_BOT_TOKEN='987654321:fixture-rotated-bot';await expect(f.check()).rejects.toThrow('CONTACT_REQUIRED')}finally{process.env.TELEGRAM_BOT_TOKEN=before}
 });
 it('returns an owned replay hint only, with no contact or authentication cache and no checkout leakage',async()=>{
  const f=await fixture(),other=await fixture(),transport:ChapaTransport={direct:vi.fn(async()=>({status:'success',data:{auth_type:'USSD',chapa_reference:'CH'+randomUUID(),payment_status:'PENDING',request_id:'req_'+randomUUID(),expires_at:new Date(Date.now()+300000).toISOString()}})),methods:vi.fn(async()=>({status:'success',data:[{name:'Telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]})),lookup:vi.fn(async()=>{throw Error('No verification in creation guard fixture')}),validate:vi.fn(async()=>{throw Error('No validation in creation guard fixture')}),create:vi.fn(async()=>{throw Error('No hosted payment in fixture')})};
  expect((await f.check()).replayExists).toBe(false);
  await createCurrentDirectCheckout(db,f.userId,{key:f.key,purpose:'TOP_UP',flow:'DIRECT',paymentMethod:'telebirr',phone:'0911652904',amount:'5.00'},f.auth.reauthorize,transport);
  expect((await f.check()).replayExists).toBe(true);expect((await db.$transaction(tx=>other.authorize(tx,other.userId,f.key))).replayExists).toBe(false);expect((await db.$transaction(tx=>f.authorize(tx,f.userId,randomUUID()))).replayExists).toBe(false);expect(transport.direct).toHaveBeenCalledOnce();expect(transport.lookup).not.toHaveBeenCalled();
 });
 it('replaces the three sequential reauthorization, contact and replay reads with one fresh statement',async()=>{
  const f=await fixture(),prior:string[]=[],current:string[]=[];capture=prior;
  try{await db.$transaction(async tx=>{await f.auth.reauthorize(tx);await eligible(tx,f.userId);await tx.chapaCheckout.findUnique({where:{userId_key:{userId:f.userId,key:f.key}}})})}finally{capture=null}
  capture=current;try{await f.check()}finally{capture=null}
  expect(prior.filter(sql=>/^\s*SELECT\b/i.test(sql))).toHaveLength(3);expect(current.filter(sql=>/^\s*SELECT\b/i.test(sql))).toHaveLength(1);
 });
});
