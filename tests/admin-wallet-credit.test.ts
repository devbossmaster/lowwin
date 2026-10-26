import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {AdminError} from '../src/modules/admin/errors';
const access=vi.hoisted(()=>({id:'',role:'OWNER',authorized:true}));
vi.mock('@/modules/admin/boundary',()=>({requireAdmin:async(_tx:unknown,_headers:unknown,options:{authorized?:boolean})=>{
 if(!access.authorized)throw new AdminError(403,'Staff sign-in is required.');
 return {...access,now:new Date(),sessionId:'fixture-staff-session'};
}}));
import {addAdminFunds,adminCreditSchema} from '../src/modules/payments/admin-credit';
import {reconcilePayments,listOwnTopups} from '../src/modules/payments/service';
import {reconcile} from '../src/modules/wallet/ledger';
import {creditTransfer} from '../src/modules/payments/credit';
import {campaignContent} from '../src/modules/notifications/campaigns';
import {dispatchOne} from '../src/modules/notifications/service';
import type {Bot} from 'grammy';

it('accepts a blank transaction ID but rejects missing reasons and inexact or excessive amounts',()=>{
 const input={id:randomUUID(),key:randomUUID(),amountCents:'1',reason:'Courtesy credit'};
 expect(adminCreditSchema.parse(input).reference).toBe('');
 for(const change of [{amountCents:'0'},{amountCents:'1.1'},{amountCents:'1000001'},{reason:''}])expect(adminCreditSchema.safeParse({...input,...change}).success).toBe(false);
});
const url=process.env.ADMIN_CREDIT_TEST_DATABASE_URL;
describe.skipIf(!url)('admin funds on disposable PostgreSQL',()=>{
 let db:PrismaClient,userId:string;
 beforeAll(async()=>{
  const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable loopback database only');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',PAYMENTS_TEST_ENABLED:'true',VERIFY_ET_API_KEY:'fixture-only-key',VERIFY_ET_TEST_ENDPOINT:'http://127.0.0.1:8030/api/verify',TELEGRAM_BOT_TOKEN:'123456789:fixture'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();userId=randomUUID();access.id=randomUUID();
  await db.user.createMany({data:[{id:userId,name:'Credit fixture'},{id:access.id,name:'Owner fixture'}]});
 },60000);
 beforeEach(()=>{access.role='OWNER';access.authorized=true;process.env.PAYMENTS_TEST_ENABLED='true'});
 afterAll(async()=>{await db?.$disconnect()});
 async function fixture(reference:string|null=null){
  const t=await db.topUpIntent.create({data:{userId,key:randomUUID(),provider:'VERIFY_ET',channel:'telebirr',status:'PROVIDER_OUTAGE',points:0,amountFromReceipt:true,policyVersion:'fixture',quoteSnapshot:{minCents:'100',maxCents:'1000000',earliestTransferAt:new Date(Date.now()-5*86400000).toISOString()},receivingAccount:'0911111111',reference,createdAt:new Date(Date.now()-4*86400000),expiresAt:new Date(Date.now()-3*86400000)}});
  return {key:randomUUID(),id:t.id,amountCents:'3027',reason:'Support courtesy credit',reference:reference??''};
 }
 it('commits exact funds, owner attribution, one private alert and one queued bot message without a transaction ID',async()=>{
  const b=await fixture(),result=await addAdminFunds(db,new Headers(),b);
  expect(result).toMatchObject({status:'CREDITED',amountCents:'3027'});
  const saved=await db.adminWalletCredit.findUniqueOrThrow({where:{sourceIntentId:b.id}});
  expect(saved).toMatchObject({actorId:access.id,userId,amountCents:3027n,reference:null,channel:null});
  expect(await db.paymentClaim.count({where:{intentId:result.intentId}})).toBe(0);
  const journal=await db.journal.findUniqueOrThrow({where:{id:saved.journalId},include:{postings:{include:{account:true}}}});
  expect(journal.kind).toBe('ADMIN_CREDIT');expect(journal.postings.map(p=>[p.account.name,p.delta.toString()]).sort()).toEqual([['platform:issuance','-30.27'],[`user:${userId}:available`,'30.27']]);
  expect(await db.topUpIntent.findUnique({where:{id:b.id}})).toMatchObject({status:'REJECTED',caseState:'RESOLVED',reasonCode:'ADMIN_CREDIT_REPLACEMENT'});
  const row=await db.outbox.findUniqueOrThrow({where:{key:`deposit:${result.intentId}:credited`}});
  expect(row.state).toBe('PENDING');expect(await db.notificationInbox.findUnique({where:{key:row.key}})).toMatchObject({userId,title:'Funds added · ገንዘብ ተጨምሯል',href:'/wallet'});
  expect(await campaignContent(db,row)).toMatchObject({body:expect.stringContaining('admin added ETB 30.27')});
  expect(await campaignContent(db,{...row,payload:{intentId:result.intentId,recipientUserId:access.id}})).toBeNull();
  expect((await listOwnTopups(db,userId)).items.find(t=>t.id===result.intentId)).toMatchObject({channel:'manual',status:'CREDITED',amountCents:'3027'});
  expect(await reconcile(db)).toEqual([]);expect(await reconcilePayments(db)).toEqual([]);
 });
 it('serializes simultaneous retries and blocks another key or changed payload after success',async()=>{
  const b=await fixture(),results=await Promise.all([addAdminFunds(db,new Headers(),b),addAdminFunds(db,new Headers(),b)]);
  expect(results[0]).toEqual(results[1]);
  await expect(addAdminFunds(db,new Headers(),{...b,key:randomUUID()})).rejects.toMatchObject({status:409});
  await expect(addAdminFunds(db,new Headers(),{...b,amountCents:'5000'})).rejects.toMatchObject({status:409});
  expect(await db.adminWalletCredit.count({where:{sourceIntentId:b.id}})).toBe(1);
  expect(await db.outbox.count({where:{key:`deposit:${results[0].intentId}:credited`}})).toBe(1);
 });
 it('preserves a known reference and excludes it from future manual and automatic credit',async()=>{
  const reference='FIXTURE'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),b=await fixture(reference);
  await addAdminFunds(db,new Headers(),{...b,reference:''});
  const duplicate=await fixture(reference);
  await expect(addAdminFunds(db,new Headers(),duplicate)).rejects.toMatchObject({status:409});
  const t=await db.topUpIntent.findUniqueOrThrow({where:{id:duplicate.id}});
  expect(await db.$transaction(tx=>creditTransfer(tx,t,{reference,aliases:[reference],amountCents:3027n,points:new Prisma.Decimal('30.27'),receiverSuffix:'1111',transferredAt:new Date(),evidenceHash:'fixture'}))).toBeNull();
  await expect(addAdminFunds(db,new Headers(),{...duplicate,reference:'OTHER123456'})).rejects.toMatchObject({status:409});
 });
 it.each(['PAYMENTS_OPERATOR','SUPPORT','AUDITOR','CATALOG_MANAGER'])('rejects %s for direct funds',async role=>{
  const b=await fixture();access.role=role;await expect(addAdminFunds(db,new Headers(),b)).rejects.toMatchObject({status:403});
  expect(await db.adminWalletCredit.count({where:{sourceIntentId:b.id}})).toBe(0);
 });
 it('requires authorized MFA and enabled funding',async()=>{
  const b=await fixture();access.authorized=false;await expect(addAdminFunds(db,new Headers(),b)).rejects.toMatchObject({status:403});
  access.authorized=true;process.env.PAYMENTS_TEST_ENABLED='false';await expect(addAdminFunds(db,new Headers(),b)).rejects.toMatchObject({status:503});
 });
 it('blocks a running lease and protected deposit',async()=>{
  const b=await fixture();await db.topUpIntent.update({where:{id:b.id},data:{leaseUntil:new Date(Date.now()+60000)}});
  await expect(addAdminFunds(db,new Headers(),b)).rejects.toMatchObject({status:409});
  await db.topUpIntent.update({where:{id:b.id},data:{leaseUntil:null,caseState:'ESCALATED'}});
  await expect(addAdminFunds(db,new Headers(),b)).rejects.toMatchObject({status:409});
 });
 it('rolls back funds, review state and notifications if queueing fails',async()=>{
  const b=await fixture();const failing=db.$extends({query:{outbox:{create:async()=>{throw Error('Fixture queue failure')}}}}) as unknown as PrismaClient;
  await expect(addAdminFunds(failing,new Headers(),b)).rejects.toThrow('Fixture queue failure');
  expect(await db.adminWalletCredit.count({where:{sourceIntentId:b.id}})).toBe(0);
  expect(await db.operation.count({where:{scope:'ADMIN_CREDIT',key:b.id}})).toBe(0);
  expect(await db.topUpIntent.findUnique({where:{id:b.id}})).toMatchObject({status:'PROVIDER_OUTAGE',caseState:'OPEN'});
 });
 it('database guards reject invented credited receipts and edits to permanent admin credits',async()=>{
  await expect(db.topUpIntent.create({data:{userId,key:randomUUID(),provider:'ADMIN_CREDIT',channel:'manual',status:'CREDITED',points:1,expectedCents:100n,policyVersion:'admin-credit-v1'}})).rejects.toThrow();
  const b=await fixture();await addAdminFunds(db,new Headers(),b);
  await expect(db.adminWalletCredit.update({where:{sourceIntentId:b.id},data:{amountCents:1n}})).rejects.toThrow();
  await expect(db.topUpIntent.update({where:{id:b.id},data:{status:'PENDING'}})).rejects.toThrow();
  expect(await reconcilePayments(db)).toEqual([]);
 });
 it('delivers the committed credit through the existing bot dispatcher and retries a transport failure without adding funds again',async()=>{
  const b=await fixture(),result=await addAdminFunds(db,new Headers(),b),telegramId=String(Date.now());
  await db.user.update({where:{id:userId},data:{telegramId}});
  await db.botChat.create({data:{telegramId,chatId:telegramId}});
  const key=`deposit:${result.intentId}:credited`;
  await db.outbox.update({where:{key},data:{nextAttemptAt:new Date(0)}});
  process.env.MINI_APP_URL='https://fixture.invalid';
  const send=vi.fn().mockRejectedValueOnce({error_code:429,parameters:{retry_after:1}}).mockResolvedValue({message_id:123});
  const bot={api:{sendPhoto:send,sendMessage:send}} as unknown as Pick<Bot,'api'>;
  expect(await dispatchOne(db,bot)).toBe(true);
  expect(await db.outbox.findUnique({where:{key}})).toMatchObject({state:'PENDING',attempts:1,lastError:'RATE_LIMIT'});
  await db.outbox.update({where:{key},data:{nextAttemptAt:new Date(0)}});
  expect(await dispatchOne(db,bot)).toBe(true);
  expect(await db.outbox.findUnique({where:{key}})).toMatchObject({state:'SENT',attempts:2});
  expect(send).toHaveBeenCalledTimes(2);
  const last=send.mock.calls[1],options=last[2];
  expect(options.reply_markup.inline_keyboard[0][0]).toEqual({text:'View wallet',web_app:{url:'https://fixture.invalid/wallet'}});
  expect(options.caption??last[1]).toContain('Lowwin admin added ETB 30.27');
  expect(await db.adminWalletCredit.count({where:{sourceIntentId:b.id}})).toBe(1);
  expect(await db.notificationInbox.count({where:{key}})).toBe(1);
 });
});
