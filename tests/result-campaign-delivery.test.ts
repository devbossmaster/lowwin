import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient,type Prisma,type Outbox} from '@prisma/client';
import type {Bot} from 'grammy';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {TEST_TOKEN} from './helpers';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction} from '../src/modules/auctions/settlement';
import {expandCampaign} from '../src/modules/notifications/campaigns';
import {dispatchOne} from '../src/modules/notifications/service';
import {hasResultSubscription,resultRecipientIds} from '../src/modules/notifications/result-audience';
import {encryptPhone} from '../src/modules/auth/own-contact';

const url=process.env.RESULT_NOTIFICATION_TEST_DATABASE_URL;
describe.skipIf(!url)('published result Telegram campaign, isolated database and mocked transport',()=>{
 let db:PrismaClient,auctionId:string,root:Outbox,subscribers:{id:string;telegramId:string}[],excluded:{id:string;telegramId:string}[];
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',TELEGRAM_BOT_TOKEN:TEST_TOKEN,MINI_APP_URL:'https://lowwin.example/telegram',PHONE_CONTACT_KEY_ID:'fixture-test',PHONE_CONTACT_KEYS:JSON.stringify({'fixture-test':'e'.repeat(64)}),REFERRAL_REWARDS_SCHEMA_READY:'false'});
  db=new PrismaClient();
  subscribers=Array.from({length:252},(_,i)=>({id:randomUUID(),telegramId:String(780000000+i)}));
  excluded=Array.from({length:8},(_,i)=>({id:randomUUID(),telegramId:String(790000000+i)}));
  const all=[...subscribers,...excluded];
  await db.user.createMany({data:all.map((u,i)=>({...u,name:'Result subscriber '+i,role:i===all.length-2?'admin':'member'}))});
  await db.notificationPreference.createMany({data:all.filter(u=>u.id!==excluded[1].id).map(u=>({userId:u.id,telegram:u.id!==excluded[0].id,inApp:false}))});
  await db.botChat.createMany({data:all.filter(u=>u.id!==excluded[3].id).map(u=>({telegramId:u.telegramId,chatId:u.telegramId,blocked:u.id===excluded[2].id}))});
  await db.telegramOwnContact.createMany({data:all.map((u,i)=>({userId:u.id,telegramId:u.telegramId,botId:u.id===excluded[5].id?'999999999':'123456789',phoneCipher:encryptPhone('+251911652904','123456789'),phoneHash:randomUUID(),lastFour:'2904',verifiedAt:new Date(),sourceUpdateId:BigInt(780000000+i),revokedAt:u.id===excluded[4].id?new Date():null}))});
  await db.staffMember.create({data:{userId:excluded[7].id,role:'OWNER',recoveryHashes:[]}});
  const userId=await bidUser(db),a=await bidAuction(db,{isDemo:false,endDelayMs:1800});auctionId=a.id;
  await submitBid(db,{userId,auctionSlug:a.slug!,amount:'5',key:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,1900));await closeAuction(db,a.id);
  root=await db.outbox.findFirstOrThrow({where:{kind:'AUCTION_FINALIZED',settlement:{is:{auctionId}}}});
 },30000);
 afterAll(async()=>{await db?.$disconnect()});
 const botWith=(sendMessage:ReturnType<typeof vi.fn>)=>({api:{sendMessage}} as unknown as Pick<Bot,'api'>);
 async function onlyJob(userId:string){
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED'}});
  return db.outbox.update({where:{key:`settlement:${root.settlementId}:completed:user:${userId}`},data:{state:'PENDING',nextAttemptAt:new Date(),attempts:0,lastError:null}});
 }
 it('includes nonparticipants, excludes every ineligible audience, and bounds immutable cursor batches',async()=>{
  expect(await db.bid.count({where:{userId:{in:subscribers.map(u=>u.id)},auctionId}})).toBe(0);
  const pub=await db.resultPublication.findUniqueOrThrow({where:{settlementId:root.settlementId!}});
  const first=await db.$transaction(tx=>resultRecipientIds(tx,pub.publishedAt));expect(first).toHaveLength(250);
  for(const u of excluded)expect(await db.$transaction(tx=>hasResultSubscription(tx,u.id))).toBe(false);
  expect(await db.$transaction(tx=>expandCampaign(tx,root))).toBe(250);
  const cursor=await db.outbox.findFirstOrThrow({where:{kind:'GLOBAL_CAMPAIGN',settlementId:root.settlementId}});
  expect(await db.$transaction(tx=>expandCampaign(tx,cursor))).toBe(2);
  expect(await db.outbox.count({where:{kind:'AUCTION_RESULT',settlementId:root.settlementId}})).toBe(252);
 });
 it('restarts and duplicate root intents retain one logical settlement-recipient announcement',async()=>{
  await db.$transaction(tx=>expandCampaign(tx,root));
  await db.$transaction(tx=>expandCampaign(tx,{...root,key:'legacy-alias',payload:{auctionId,settlementId:root.settlementId}}));
  expect(await db.outbox.count({where:{kind:'AUCTION_RESULT',settlementId:root.settlementId}})).toBe(252);
 });
 it('rechecks subscriptions after fanout without changing financial or publication records',async()=>{
  const u=subscribers[0],job=await onlyJob(u.id),send=vi.fn();
  const before=await db.journal.count();await db.notificationPreference.update({where:{userId:u.id},data:{telegram:false}});
  expect(await dispatchOne(db,botWith(send))).toBe(true);expect(send).not.toHaveBeenCalled();
  expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).lastError).toBe('RESULT_RECIPIENT_INELIGIBLE');expect(await db.journal.count()).toBe(before);
 });
 it('sends once under concurrent workers, opens the exact result, and does not duplicate participant Telegram',async()=>{
  const u=subscribers[1],job=await onlyJob(u.id),send=vi.fn(async(_chat:string,_text:string,_options:unknown)=>({message_id:101}));
  await Promise.all([dispatchOne(db,botWith(send)),dispatchOne(db,botWith(send))]);expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toBe(u.telegramId);
  expect(JSON.stringify(send.mock.calls[0][2])).toMatch(/https:\/\/lowwin\.example\/winners\/\d+/);
  expect(await db.telegramMessage.count({where:{outboxId:job.id}})).toBe(1);expect(await db.notificationInbox.count({where:{key:job.key}})).toBe(0);
  // An old independently keyed result job cannot produce a second public copy.
  await db.outbox.create({data:{key:randomUUID(),kind:'AUCTION_RESULT',payload:{...job.payload as Prisma.JsonObject},settlementId:root.settlementId}});
  await dispatchOne(db,botWith(send));expect(send).toHaveBeenCalledTimes(1);
 });
 it('honors Telegram retry_after and stops blocked recipients with bounded retries',async()=>{
  const u=subscribers[2],job=await onlyJob(u.id),send=vi.fn(async()=>{throw {error_code:429,parameters:{retry_after:9}}});
  await dispatchOne(db,botWith(send));let current=await db.outbox.findUniqueOrThrow({where:{id:job.id}});
  expect(current).toMatchObject({state:'PENDING',attempts:1,lastError:'RATE_LIMIT'});expect(current.nextAttemptAt.getTime()-Date.now()).toBeGreaterThan(7000);
  await db.outbox.update({where:{id:job.id},data:{nextAttemptAt:new Date()}});send.mockImplementation(async()=>{throw {error_code:403}});
  await dispatchOne(db,botWith(send));current=await db.outbox.findUniqueOrThrow({where:{id:job.id}});expect(current).toMatchObject({state:'FAILED',attempts:2,lastError:'CHAT_BLOCKED'});expect((await db.botChat.findUniqueOrThrow({where:{telegramId:u.telegramId}})).blocked).toBe(true);
 });
});
