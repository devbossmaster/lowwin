import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {chapaReceiptContent,chapaReceiptKind,queueChapaReceipt} from '../src/modules/notifications/chapa-receipt';
import {dispatchOne,materializeAlert} from '../src/modules/notifications/service';

const id='5ed925b4-41fa-418a-8a65-22e530ed07c4',botId='123456789',userId='receipt-owner';
const receipt=()=>({id,userId,purpose:'TOP_UP',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'balanced-receipt',bidId:null,receipt:null,currency:'ETB',amountCents:1000n,mode:'test',phoneBotId:botId,user:{telegramId:'900000001',ownContact:{telegramId:'900000001',botId,revokedAt:null}}});
const row=()=>({id:'receipt-outbox',key:`chapa:${id}:telegram-confirmed`,kind:chapaReceiptKind,payload:{checkoutId:id,recipientUserId:userId},state:'PENDING',attempts:0,nextAttemptAt:new Date(0),createdAt:new Date(0),sentAt:null,lastError:null,settlementId:null,testRunId:null}) as Outbox;
function contentTx(order:unknown=receipt()){return {chapaCheckout:{findUnique:vi.fn(async()=>order)}} as unknown as Prisma.TransactionClient}

beforeEach(()=>{vi.stubEnv('TELEGRAM_BOT_TOKEN',botId+':receipt-fixture-token');vi.stubEnv('CHAPA_MODE','test');vi.stubEnv('MINI_APP_URL','https://lowwin.test')});
afterEach(()=>vi.unstubAllEnvs());

describe('verified Chapa Telegram receipts',()=>{
 it('enqueues only one immutable job for duplicate confirmation attempts',async()=>{
  const jobs=new Map<string,unknown>(),upsert=vi.fn(async({where,create}:{where:{key:string};create:unknown})=>{if(!jobs.has(where.key))jobs.set(where.key,create);return jobs.get(where.key)}),tx={outbox:{upsert}} as unknown as Prisma.TransactionClient;
  await queueChapaReceipt(tx,receipt());await queueChapaReceipt(tx,receipt());
  expect(jobs.size).toBe(1);expect(jobs.get(`chapa:${id}:telegram-confirmed`)).toEqual({key:`chapa:${id}:telegram-confirmed`,kind:chapaReceiptKind,payload:{checkoutId:id,recipientUserId:userId}});
  expect(upsert.mock.calls.every(([input])=>JSON.stringify(input).includes('"update":{}'))).toBe(true);
 });
 it.each([
  {creditJournalId:null},{providerStatus:'PENDING'},{verificationState:'MISMATCH'},{currency:'USD'},{amountCents:0n},{status:'PENDING'},{purpose:'OTHER'},
  {purpose:'BID',status:'BID_ACCEPTED',bidId:null},{purpose:'BID',status:'BID_ACCEPTED',bidId:'bid',receipt:null},
 ])('never queues an uncommitted or unsuccessful payment %#',async change=>{
  const upsert=vi.fn(),tx={outbox:{upsert}} as unknown as Prisma.TransactionClient;
  expect(await queueChapaReceipt(tx,{...receipt(),...change})).toBeNull();expect(upsert).not.toHaveBeenCalled();
 });
 it('renders a concise TEST-marked bilingual top-up with its owned payment button',async()=>{
  const content=await chapaReceiptContent(contentTx(),row());
  expect(content).toMatchObject({userId,href:`/payments/chapa/return?checkout=${id}`});
  expect(content?.body).toContain('✅ TEST · 10.00 ETB credited to your wallet.');expect(content?.body).toContain('10.00 ብር ወደ ዋሌትዎ ገብቷል።');expect(content?.buttonLabel).toContain('Open Lowwin');
 });
 it('announces an accepted bid only when the committed bid receipt exists',async()=>{
  const order={...receipt(),purpose:'BID',status:'BID_ACCEPTED',bidId:'accepted-bid',receipt:{bid:{id:'accepted-bid'}}};
  const content=await chapaReceiptContent(contentTx(order),row());expect(content?.body).toContain('Bid accepted.');
  expect(await chapaReceiptContent(contentTx({...order,receipt:null}),row())).toBeNull();
 });
 it('states that verified late-bid funds are in the wallet without claiming acceptance',async()=>{
  const content=await chapaReceiptContent(contentTx({...receipt(),purpose:'BID',status:'NEEDS_REVIEW'}),row());
  expect(content?.body).toContain('This bid was not accepted.');expect(content?.body).toContain('credited to your wallet.');expect(content?.body).not.toContain('Bid accepted.');
 });
 it.each(['pending','owner','bot','mode','telegram','contact-bot','revoked','missing-contact'])('fails closed on %s receipt mismatch',async mismatch=>{
  const order=receipt();
  if(mismatch==='pending')order.status='PENDING';
  if(mismatch==='owner')order.userId='another-account';
  if(mismatch==='bot')order.phoneBotId='987654321';
  if(mismatch==='mode')order.mode='live';
  if(mismatch==='telegram')order.user.ownContact.telegramId='another-telegram';
  if(mismatch==='contact-bot')order.user.ownContact.botId='other-bot';
  if(mismatch==='revoked')Reflect.set(order.user.ownContact,'revokedAt',new Date());
  if(mismatch==='missing-contact')Reflect.set(order.user,'ownContact',null);
  expect(await chapaReceiptContent(contentTx(order),row())).toBeNull();
 });
 it('does not create a second Mini App inbox notification',async()=>{
  const upsert=vi.fn(),tx={notificationInbox:{upsert}} as unknown as Prisma.TransactionClient;
  await materializeAlert(tx,row());expect(upsert).not.toHaveBeenCalled();
 });
 it('sends a plain receipt through the existing worker and does not resend its completed job',async()=>{
  const job=row(),order=receipt(),sendMessage=vi.fn(async()=>({message_id:42})),sendPhoto=vi.fn();
  const tx={
   $executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>null)},
   $queryRaw:vi.fn(async()=>job.state==='PENDING'?[job]:[]),chapaCheckout:{findUnique:vi.fn(async()=>order)},
   outbox:{update:vi.fn(async({data}:{data:Record<string,unknown>})=>Object.assign(job,data))},
   user:{findUnique:vi.fn(async()=>({telegramId:order.user.telegramId,name:'Player name'}))},
   botChat:{findUnique:vi.fn(async()=>({telegramId:order.user.telegramId,chatId:order.user.telegramId,blocked:false}))},
   telegramMessage:{create:vi.fn(async()=>({id:'message'}))},notificationInbox:{upsert:vi.fn()},
  };
  const client={$transaction:async(callback:(value:unknown)=>unknown)=>callback(tx)} as unknown as PrismaClient;
  const bot={api:{sendMessage,sendPhoto}} as never;
  expect(await dispatchOne(client,bot)).toBe(true);expect(job.state).toBe('SENT');expect(await dispatchOne(client,bot)).toBe(false);
  expect(sendMessage).toHaveBeenCalledTimes(1);expect(sendPhoto).not.toHaveBeenCalled();expect(tx.notificationInbox.upsert).not.toHaveBeenCalled();
  const [chat,text,options]=sendMessage.mock.calls[0] as unknown as [string,string,{reply_markup:{inline_keyboard:Array<Array<{text:string;web_app:{url:string}}>>}}];
  expect(chat).toBe(order.user.telegramId);expect(text).toMatch(/^✅ TEST · 10\.00 ETB/);expect(text).not.toContain('Player name');expect(text).not.toContain('@LowWinChat');
  expect(options.reply_markup.inline_keyboard[0][0]).toEqual({text:expect.stringContaining('Open Lowwin'),web_app:{url:`https://lowwin.test/payments/chapa/return?checkout=${id}`}});
 });
 it('claims only Chapa receipts with the filtered worker and leaves other jobs untouched',async()=>{
  const unrelated=['GLOBAL_CAMPAIGN','BROADCAST','AUCTION_PUBLISHED','TELEGRAM_DELETE'].map((kind,index)=>({...row(),id:`other-${index}`,kind}));
  const job=row(),fixture=dispatchFixture([...unrelated,job]);
  expect(await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind})).toBe(true);
  expect(job.state).toBe('SENT');expect(unrelated.every(other=>other.state==='PENDING')).toBe(true);
  expect(await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind})).toBe(false);
  expect(fixture.sendMessage).toHaveBeenCalledTimes(1);
  const [query,kind]=fixture.tx.$queryRaw.mock.calls[0];
  expect(query.join('?')).toContain('kind=?');expect(kind).toBe(chapaReceiptKind);
  expect(query.join('?')).toContain('FOR UPDATE SKIP LOCKED');
 });
 it('retries the same rate-limited receipt only when due and never resends a sent job',async()=>{
  const job=row(),fixture=dispatchFixture([job]);
  fixture.sendMessage.mockRejectedValueOnce({error_code:429,parameters:{retry_after:60}});
  await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind});
  expect(job).toMatchObject({state:'PENDING',attempts:1,lastError:'RATE_LIMIT'});
  expect(await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind})).toBe(false);
  job.nextAttemptAt=new Date(0);
  await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind});
  expect(job).toMatchObject({id:'receipt-outbox',state:'SENT',attempts:2,lastError:null});
  expect(await dispatchOne(fixture.client,fixture.bot,{kind:chapaReceiptKind})).toBe(false);
  expect(fixture.sendMessage).toHaveBeenCalledTimes(2);expect(fixture.tx.telegramMessage.create).toHaveBeenCalledTimes(1);
 });
 it('rejects unsupported filtered dispatch before touching the database',async()=>{
  const fixture=dispatchFixture([]);
  await expect(dispatchOne(fixture.client,fixture.bot,{kind:'BROADCAST'} as never)).rejects.toThrow('Unsupported notification dispatch filter');
  expect(fixture.tx.$queryRaw).not.toHaveBeenCalled();
 });
});

function dispatchFixture(jobs:Outbox[]){
 const sendMessage=vi.fn(async()=>({message_id:42})),sendPhoto=vi.fn(),order=receipt();
 const tx={
  $executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>null)},
  $queryRaw:vi.fn(async(query:TemplateStringsArray,...values:unknown[])=>jobs.filter(job=>job.state==='PENDING'&&job.nextAttemptAt.getTime()<=Date.now()&&(!query.join('').includes('kind=')||job.kind===values[0])).slice(0,1)),
  chapaCheckout:{findUnique:vi.fn(async()=>order)},
  outbox:{update:vi.fn(async({where,data}:{where:{id:string};data:Record<string,unknown>})=>{
   const job=jobs.find(item=>item.id===where.id)!;
   const attempts=typeof data.attempts==='object'?job.attempts+1:data.attempts;
   return Object.assign(job,data,attempts===undefined?{}:{attempts});
  })},
  user:{findUnique:vi.fn(async()=>({telegramId:order.user.telegramId,name:'Player name'}))},
  botChat:{findUnique:vi.fn(async()=>({telegramId:order.user.telegramId,chatId:order.user.telegramId,blocked:false}))},
  telegramMessage:{create:vi.fn(async()=>({id:'message'}))},notificationInbox:{upsert:vi.fn()},
 };
 return {tx,sendMessage,sendPhoto,client:{$transaction:async(callback:(value:unknown)=>unknown)=>callback(tx)} as unknown as PrismaClient,bot:{api:{sendMessage,sendPhoto}} as never};
}
