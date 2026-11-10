import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {chapaPaymentAlertRecipient,chapaReceiptContent,chapaReceiptKind,queueChapaReceipt} from '../src/modules/notifications/chapa-receipt';
import {dispatchOne,materializeAlert} from '../src/modules/notifications/service';
import {notificationDispatchFixture} from './notification-dispatch-fixture';

const id='5ed925b4-41fa-418a-8a65-22e530ed07c4',botId='123456789',userId='receipt-owner';
const receipt=()=>({id,userId,purpose:'TOP_UP',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'balanced-receipt',bidId:null,receipt:null,currency:'ETB',amountCents:1000n,mode:'test',phoneBotId:botId,merchantReference:'LWfixture1234567890',chapaReference:'CHfixture',user:{telegramId:'900000001',ownContact:{telegramId:'900000001',botId,revokedAt:null}}});
const row=()=>({id:'receipt-outbox',key:`chapa:${id}:telegram-confirmed`,kind:chapaReceiptKind,payload:{checkoutId:id,recipientUserId:userId},state:'PENDING',attempts:0,nextAttemptAt:new Date(0),createdAt:new Date(0),sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null,testRunId:null}) as Outbox;
function contentTx(order:unknown=receipt()){return {chapaCheckout:{findUnique:vi.fn(async()=>order)}} as unknown as Prisma.TransactionClient}

beforeEach(()=>{vi.stubEnv('TELEGRAM_BOT_TOKEN',botId+':receipt-fixture-token');vi.stubEnv('CHAPA_MODE','test');vi.stubEnv('MINI_APP_URL','https://lowwin.test');vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','')});
afterEach(()=>vi.unstubAllEnvs());

describe('verified Chapa Telegram receipts',()=>{
 it('reports every accepted number in one committed batch receipt',async()=>{const order={...receipt(),purpose:'BID',status:'BID_ACCEPTED',bidId:'first-bid',amountCents:3000n,receipt:{receipts:[{bid:{id:'first-bid',amount:'2.00'}},{bid:{id:'second-bid',amount:'3.00'}},{bid:{id:'third-bid',amount:'4.00'}}]}};const content=await chapaReceiptContent(contentTx(order),row());expect(content?.body).toContain('3 bids accepted');expect(content?.body).toContain('2.00 · 3.00 · 4.00');expect(content?.body).toContain('30.00 ETB')});
 it.each(['','@cryptonbozz','-1001234567','0','123:token',' 123','123\n','4503599627370496'])('rejects unsafe merchant alert destination %j',value=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID',value);expect(chapaPaymentAlertRecipient()).toBeNull();
 });
 it('queues one separate merchant alert alongside the customer receipt on repeated verification',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');
  const jobs=new Map<string,unknown>(),tx={outbox:{upsert:vi.fn(async({where,create})=>{if(!jobs.has(where.key))jobs.set(where.key,create);return jobs.get(where.key)})}} as unknown as Prisma.TransactionClient;
  await queueChapaReceipt(tx,receipt());await queueChapaReceipt(tx,receipt());expect(jobs.size).toBe(2);
  expect(jobs.get(`chapa:${id}:merchant-confirmed:900000002`)).toMatchObject({kind:chapaReceiptKind,payload:{checkoutId:id,recipientUserId:userId,merchantRecipientTelegramId:'900000002'}});
 });
 it('does not queue merchant alerts for unverified or pending funds even when configured',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');const upsert=vi.fn(),tx={outbox:{upsert}} as unknown as Prisma.TransactionClient;
  for(const change of [{creditJournalId:null},{providerStatus:'PENDING'},{verificationState:'MISMATCH'},{status:'PENDING'}])await queueChapaReceipt(tx,{...receipt(),...change});
  expect(upsert).not.toHaveBeenCalled();
 });
 it('renders a private merchant alert without customer contact details or a customer-owned return link',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');
  const content=await chapaReceiptContent(contentTx(),{...row(),payload:{...row().payload as object,merchantRecipientTelegramId:'900000002'}});
  expect(content).toMatchObject({recipientTelegramId:'900000002',merchantAlert:true,href:'/admin/payments',buttonLabel:'View payments'});
  expect(content?.body).toContain('TEST · Payment received: 10.00 ETB');expect(content?.body).toContain('Wallet deposit');expect(content?.body).toContain('CHfixture');
  expect(content?.body).not.toContain('900000001');expect(content?.body).not.toContain(userId);
 });
 it('rechecks merchant recipient configuration and cannot redirect a queued alert to another account',async()=>{
  const job={...row(),payload:{...row().payload as object,merchantRecipientTelegramId:'900000002'}};
  for(const target of ['','900000003','@cryptonbozz']){vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID',target);expect(await chapaReceiptContent(contentTx(),job)).toBeNull()}
 });
 it('does not send merchant alerts for a different payment mode or bot',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');const job={...row(),payload:{...row().payload as object,merchantRecipientTelegramId:'900000002'}};
  for(const change of [{mode:'live'},{phoneBotId:'another-bot'},{chapaReference:null},{creditJournalId:null}])expect(await chapaReceiptContent(contentTx({...receipt(),...change}),job)).toBeNull();
 });
 it('delivers a merchant alert only to its started private chat with an admin URL and no second inbox item',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');const job={...row(),payload:{...row().payload as object,merchantRecipientTelegramId:'900000002'}};
  const f=dispatchFixture([job]);f.tx.botChat.findUnique.mockResolvedValue({telegramId:'900000002',chatId:'900000002',blocked:false});
  await dispatchOne(f.client,f.bot,{kind:chapaReceiptKind});expect(f.tx.user.findUnique).not.toHaveBeenCalled();expect(f.tx.botChat.findUnique).toHaveBeenCalledWith({where:{telegramId:'900000002'}});
  expect(f.sendMessage).toHaveBeenCalledWith('900000002',expect.stringContaining('Payment received: 10.00 ETB'),{reply_markup:{inline_keyboard:[[{text:'View payments',url:'https://lowwin.test/admin/payments'}]]}});
  expect(f.tx.notificationInbox.upsert).not.toHaveBeenCalled();expect(job.state).toBe('SENT');await dispatchOne(f.client,f.bot,{kind:chapaReceiptKind});expect(f.sendMessage).toHaveBeenCalledTimes(1);
 });
 it('does not deliver merchant alerts into a group or blocked chat',async()=>{
  vi.stubEnv('CHAPA_PAYMENT_ALERT_TELEGRAM_ID','900000002');
  for(const chat of [{telegramId:'900000002',chatId:'-100123',blocked:false},{telegramId:'900000002',chatId:'900000002',blocked:true}]){
   const job={...row(),payload:{...row().payload as object,merchantRecipientTelegramId:'900000002'}},f=dispatchFixture([job]);f.tx.botChat.findUnique.mockResolvedValue(chat);
   await dispatchOne(f.client,f.bot);expect(f.sendMessage).not.toHaveBeenCalled();expect(job.state).toBe('SKIPPED');
  }
 });
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
  const job=row(),order=receipt(),f=dispatchFixture([job]),{sendMessage,sendPhoto,tx,client,bot}=f;
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
  const query=fixture.tx.$queryRaw.mock.calls.map(call=>call[0]).find(value=>'sql' in value&&value.sql.includes('FOR UPDATE SKIP LOCKED')) as Prisma.Sql;
  expect(query.sql).toContain('kind=?');expect(query.values).toContain(chapaReceiptKind);
  expect(query.sql).toContain('FOR UPDATE SKIP LOCKED');
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
  expect(fixture.sendMessage).toHaveBeenCalledTimes(2);expect(fixture.tx.telegramMessage.upsert).toHaveBeenCalledTimes(1);
 });
 it('rejects unsupported filtered dispatch before touching the database',async()=>{
  const fixture=dispatchFixture([]);
  await expect(dispatchOne(fixture.client,fixture.bot,{kind:'BROADCAST'} as never)).rejects.toThrow('Unsupported notification dispatch filter');
  expect(fixture.tx.$queryRaw).not.toHaveBeenCalled();
 });
});

function dispatchFixture(jobs:Outbox[]){
 const sendMessage=vi.fn(async()=>({message_id:42})),sendPhoto=vi.fn(),order=receipt();
 const base=notificationDispatchFixture(jobs),tx=Object.assign(base.tx,{chapaCheckout:{findUnique:vi.fn(async()=>order)}});
 return {tx,sendMessage,sendPhoto,client:base.client,bot:{api:{sendMessage,sendPhoto}} as never};
}
