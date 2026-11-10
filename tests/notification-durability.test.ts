import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PrismaClient,type Outbox} from '@prisma/client';
import {Bot,InputFile} from 'grammy';
import {randomUUID} from 'node:crypto';
import {claimNotifications,claimLogicalDelivery,finishClaim} from '../src/modules/notifications/leases';
import {dispatchBatch,expandPendingCampaigns} from '../src/modules/notifications/dispatch';
import {stopBroadcast,broadcastHistory} from '../src/modules/admin/broadcast-history';
import {sendBroadcastPhoto,TelegramMediaDeferredError} from '../src/modules/notifications/broadcast-photo';
import {TEST_TOKEN} from './helpers';
import {installTelegramRateLimit} from '../src/modules/notifications/telegram-rate';
import {notificationTimingSnapshot} from '../src/modules/notifications/diagnostics';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable Telegram delivery: isolated database, simulated transport only',()=>{
 let db:PrismaClient,users:Array<{id:string;telegramId:string}>,messagesBefore=0;
 const maintenance=async(action:string)=>{const latest=await db.adminAudit.findFirst({orderBy:{createdAt:'desc'},select:{createdAt:true}});return db.adminAudit.create({data:{actorId:'isolated',action,target:'all',details:{},createdAt:new Date(Math.max(Date.now(),(latest?.createdAt.getTime()??0)+1))}})};
 const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};
 const fake=(send:ReturnType<typeof vi.fn>)=>({api:{sendMessage:send,sendPhoto:send,deleteMessage:send}} as unknown as Pick<Bot,'api'>);
 const job=(kind='BROADCAST',index=0,rootKey?:string)=>db.outbox.create({data:{key:rootKey?`${rootKey}:user:${users[index].id}`:`notification-durable:${randomUUID()}`,kind,payload:kind==='CONTACT_CONFIRMED'?{telegramId:users[index].telegramId,botId:'123456789'}:{recipientUserId:users[index].id,body:'Fixture update',href:'/',...(rootKey?{rootKey}:{})}}});
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Isolated loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,TELEGRAM_BOT_TOKEN:TEST_TOKEN,MINI_APP_URL:'https://lowwin.test/telegram'});
  db=new PrismaClient();const base=830000000+Math.floor(Math.random()*1000000);users=Array.from({length:20},(_,i)=>({id:randomUUID(),telegramId:String(base+i)}));
  await db.user.createMany({data:users.map(u=>({...u,name:'Fixture recipient',role:'member'}))});
  await db.botChat.createMany({data:users.map(u=>({telegramId:u.telegramId,chatId:u.telegramId}))});
  await db.telegramOwnContact.createMany({data:users.map(u=>({userId:u.id,telegramId:u.telegramId,botId:'123456789',phoneCipher:'isolated-unused-cipher',phoneHash:randomUUID(),lastFour:'2904',verifiedAt:new Date(),sourceUpdateId:BigInt(u.telegramId)}))});
 });
 beforeEach(async()=>{
  // This suite owns a disposable database; never configure a production URL.
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED',leaseToken:null,leaseUntil:null}});await db.telegramDeliveryLease.deleteMany();await db.telegramMediaCache.deleteMany();await maintenance('AUCTIONS_MAINTENANCE_RESUMED');messagesBefore=await db.telegramMessage.count();
  await db.botChat.updateMany({where:{telegramId:{in:users.map(u=>u.telegramId)}},data:{blocked:false}});
 });
 afterAll(async()=>{await db?.$disconnect()});
 it('claims disjoint bounded batches concurrently and leaves urgent capacity plus bulk progress',async()=>{
  for(let i=0;i<12;i++)await job(i<8?'CONTACT_CONFIRMED':'BROADCAST',i);
  const [one,two]=await Promise.all([claimNotifications(db,{limit:4}),claimNotifications(db,{limit:4})]);
  expect(new Set([...one,...two].map(r=>r.id)).size).toBe(8);expect(one).toHaveLength(4);expect(two).toHaveLength(4);
  expect(one.some(r=>r.kind==='BROADCAST')).toBe(true);expect(two.some(r=>r.kind==='BROADCAST')).toBe(true);
  expect(one.every(r=>r.leaseToken&&r.leaseUntil>new Date())).toBe(true);
 });
 it('recovers an expired claim and rejects the old worker completion and alias ownership',async()=>{
  const row=await job(),[old]=await claimNotifications(db,{limit:1});
  const original=await claimLogicalDelivery(db,old,'123456789','synthetic-auction',users[0].id);expect(original.acquired).toBe(true);
  await db.outbox.update({where:{id:row.id},data:{leaseUntil:new Date(Date.now()-1000)}});
  await db.telegramDeliveryLease.update({where:{key:original.key},data:{leaseUntil:new Date(Date.now()-1000)}});
  const [current]=await claimNotifications(db,{limit:1});expect(current.leaseToken).not.toBe(old.leaseToken);
  expect((await claimLogicalDelivery(db,current,'123456789','synthetic-auction',users[0].id)).acquired).toBe(true);
  expect(await finishClaim(db,old,{state:'SENT'},{chatId:users[0].telegramId,messageId:1,logicalKey:original.key})).toBe(false);
  expect(await finishClaim(db,current,{state:'SENT'},{chatId:users[0].telegramId,messageId:2,logicalKey:original.key})).toBe(true);
  const alias=await job(),[aliasClaim]=await claimNotifications(db,{limit:1});
  expect(aliasClaim.id).toBe(alias.id);expect(await claimLogicalDelivery(db,aliasClaim,'123456789','synthetic-auction',users[0].id)).toMatchObject({acquired:false,sent:true});
  expect(await db.telegramMessage.count()).toBe(messagesBefore+1);
 });
 it('does not hold a database transaction during HTTP; Stop returns promptly and the in-flight acknowledgement persists',async()=>{
  const rootKey=`broadcast:${randomUUID()}`,root=await db.outbox.create({data:{key:rootKey,kind:'GLOBAL_CAMPAIGN',state:'SENT',payload:{deliveryKind:'BROADCAST',rootKey}}});
  const row=await job('BROADCAST',0,root.key),later=await job('BROADCAST',1,root.key),began=deferred(),release=deferred();
  const send=vi.fn(async()=>{began.resolve();await release.promise;return {message_id:101,photo:[{file_id:'fixture-file'}]}});
  const sending=dispatchBatch(db,fake(send),{limit:1,concurrency:1});await began.promise;
  const [activity]=await db.$queryRaw<{held:bigint}[]>`SELECT COUNT(*) AS held FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`;
  expect(Number(activity.held)).toBe(0);
  const started=performance.now(),stopped=await db.$transaction(tx=>stopBroadcast(tx,root.id));expect(performance.now()-started).toBeLessThan(500);expect(stopped.remainingStopped).toBe(1);
  release.resolve();await sending;expect(send).toHaveBeenCalledTimes(1);
  expect((await db.outbox.findUniqueOrThrow({where:{id:row.id}})).state).toBe('SENT');expect((await db.outbox.findUniqueOrThrow({where:{id:later.id}})).state).toBe('SKIPPED');expect(await db.telegramMessage.count()).toBe(messagesBefore+1);
 });
 it('stops claimed-but-unsent work and pauses claims during maintenance without losing ownership',async()=>{
  const one=await job('CONTACT_CONFIRMED'),two=await job('BROADCAST',1),began=deferred(),release=deferred();let running=true;
  const send=vi.fn(async()=>{began.resolve();await release.promise;return {message_id:102}});
  const sending=dispatchBatch(db,fake(send),{limit:2,concurrency:1,shouldContinue:()=>running});await began.promise;running=false;release.resolve();await sending;
  expect(send).toHaveBeenCalledTimes(1);expect((await db.outbox.findUniqueOrThrow({where:{id:two.id}})).lastError).toBe('WORKER_STOPPING');
  expect((await db.outbox.findUniqueOrThrow({where:{id:one.id}})).state).toBe('SENT');
  await maintenance('AUCTIONS_MAINTENANCE_HALTED');expect(await claimNotifications(db)).toEqual([]);
 });
 it('rechecks a blocked recipient immediately before dispatch and applies bounded provider retry_after',async()=>{
  const row=await job(),send=vi.fn(async()=>{throw {error_code:429,parameters:{retry_after:9}}});
  await dispatchBatch(db,fake(send),{limit:1});let saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(saved).toMatchObject({state:'PENDING',attempts:1,lastError:'RATE_LIMIT'});expect(saved.nextAttemptAt.getTime()-Date.now()).toBeGreaterThan(7500);
  await db.outbox.update({where:{id:row.id},data:{nextAttemptAt:new Date(0)}});await db.botChat.update({where:{telegramId:users[0].telegramId},data:{blocked:true}});
  await dispatchBatch(db,fake(send),{limit:1});saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(saved.state).toBe('SKIPPED');expect(send).toHaveBeenCalledTimes(1);
 });
 it('uses one durable gate after a real shared-budget wait and observes Stop before HTTP',async()=>{
  const rootKey=`broadcast:${randomUUID()}`,root=await db.outbox.create({data:{key:rootKey,kind:'GLOBAL_CAMPAIGN',state:'SENT',payload:{deliveryKind:'BROADCAST',rootKey}}}),row=await job('BROADCAST',0,rootKey);
  await db.telegramRateBudget.upsert({where:{botId:'123456789'},create:{botId:'123456789',nextSendAt:new Date(Date.now()+1000)},update:{nextSendAt:new Date(Date.now()+1000),nextBulkAt:new Date(0),cooldownUntil:null,bulkWaitingUntil:null}});
  const send=vi.fn(async()=>({ok:true,result:{message_id:105,photo:[{file_id:'simulated-file'}]}})),bot=new Bot(TEST_TOKEN);
  bot.api.config.use(async()=>await send() as never);installTelegramRateLimit(bot.api,db,TEST_TOKEN);notificationTimingSnapshot(true);
  const sending=dispatchBatch(db,bot,{limit:1,concurrency:1});
  for(let i=0;i<100;i++){if((await db.telegramRateBudget.findUnique({where:{botId:'123456789'}}))?.bulkWaitingUntil)break;await new Promise(r=>setTimeout(r,5))}
  expect(notificationTimingSnapshot().stages.gate).toBeUndefined();
  await db.$transaction(tx=>stopBroadcast(tx,root.id));await sending;
  expect(send).not.toHaveBeenCalled();expect(notificationTimingSnapshot().stages.gate.count).toBe(1);
  expect(await db.outbox.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'});
 });
 it('rechecks recipient role on a rejected cached-photo fallback with one gate per HTTP attempt',async()=>{
  await job('BROADCAST');const send=vi.fn(async()=>({message_id:106,photo:[{file_id:'cached-for-fallback'}]}));await dispatchBatch(db,fake(send),{limit:1});
  const row=await job('BROADCAST',1);send.mockImplementationOnce(async()=>{await db.user.update({where:{id:users[1].id},data:{role:'admin'}});throw {error_code:400}});send.mockClear();notificationTimingSnapshot(true);
  try{
   await dispatchBatch(db,fake(send),{limit:1});
   expect(send).toHaveBeenCalledTimes(1);expect(notificationTimingSnapshot().stages.gate.count).toBe(2);expect(notificationTimingSnapshot().stages.http.count).toBe(1);
   expect(await db.outbox.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({state:'SKIPPED',lastError:'RECIPIENT_INELIGIBLE'});
  }finally{await db.user.update({where:{id:users[1].id},data:{role:'member'}})}
 });
 it('retains an accepted-send lease on acknowledgement failure rather than immediately resending',async()=>{
  const row=await job('CONTACT_CONFIRMED');const send=vi.fn(async()=>({message_id:103}));
  const original=db.$transaction.bind(db);let transactions=0;
  const wrapped=new Proxy(db,{get(target,key){if(key==='$transaction')return async(...args:Parameters<typeof db.$transaction>)=>{transactions++;if(transactions===3)throw Error('Simulated acknowledgement disconnect');return (original as (...input:unknown[])=>unknown)(...args)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  await dispatchBatch(wrapped,fake(send),{limit:1});
  const saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(saved).toMatchObject({state:'PENDING',lastError:'ACKNOWLEDGEMENT_UNCERTAIN'});expect(saved.leaseToken).toBeTruthy();
  await dispatchBatch(db,fake(send),{limit:1});expect(send).toHaveBeenCalledTimes(1);
 });
 it('renews a nearly expired owner before HTTP so another worker cannot reclaim the in-flight send',async()=>{
  const row=await job('CONTACT_CONFIRMED'),began=deferred(),release=deferred();let shortened=false;
  const original=db.$transaction.bind(db);let transactions=0;
  const nearExpiry=new Proxy(db,{get(target,key){if(key==='$transaction')return async(...args:Parameters<typeof db.$transaction>)=>{if(++transactions===2&&!shortened){shortened=true;await db.outbox.update({where:{id:row.id},data:{leaseUntil:new Date(Date.now()+25)}})}return (original as (...input:unknown[])=>unknown)(...args)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  const send=vi.fn(async()=>{const saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(saved.leaseUntil!.getTime()-Date.now()).toBeGreaterThan(90_000);began.resolve();await release.promise;return {message_id:104}});
  const sending=dispatchBatch(nearExpiry as unknown as PrismaClient,fake(send),{limit:1});await began.promise;
  expect(await claimNotifications(db,{limit:1})).toEqual([]);release.resolve();await sending;expect(send).toHaveBeenCalledTimes(1);
 });
 it('expands independently with a stable cursor, excludes unreachable/admin users and survives a repeated page',async()=>{
  const rootKey=`broadcast:${randomUUID()}`,root=await db.outbox.create({data:{key:rootKey,kind:'GLOBAL_CAMPAIGN',payload:{deliveryKind:'BROADCAST',rootKey,body:'Fixture',href:'/',audienceBefore:new Date(Date.now()+100).toISOString()}}});
  await db.botChat.update({where:{telegramId:users[1].telegramId},data:{blocked:true}});await db.user.update({where:{id:users[2].id},data:{role:'admin'}});
  expect(await expandPendingCampaigns(db,{limit:1})).toBe(1);const where={kind:'BROADCAST',key:{startsWith:root.key+':'}};const count=await db.outbox.count({where});expect(count).toBeGreaterThanOrEqual(users.length-2);
  expect(await db.outbox.count({where:{...where,payload:{path:['recipientUserId'],equals:users[1].id}}})).toBe(0);
  expect(await db.outbox.count({where:{...where,payload:{path:['recipientUserId'],equals:users[2].id}}})).toBe(0);
  await db.outbox.update({where:{id:root.id},data:{state:'PENDING'}});await expandPendingCampaigns(db,{limit:1});expect(await db.outbox.count({where})).toBe(count);
  const history=await broadcastHistory(db,{page:1,q:root.key});expect(history.items[0]).toMatchObject({eligibleRecipients:count,queued:count,retrying:0,inFlight:0,audienceComplete:true});
  await db.user.update({where:{id:users[2].id},data:{role:'member'}});
 });
 it('single-flights media upload across senders, survives a new API instance and isolates bot and version',async()=>{
  const entered=deferred(),release=deferred(),source=vi.fn(async()=>{entered.resolve();await release.promise;return new InputFile(Buffer.from('simulated-image'))});
  const send=vi.fn(async(_chat:string,_photo:unknown,_options?:unknown)=>({message_id:201,photo:[{file_id:'durable-file'}]})),options={caption:'Fixture'},persistent={client:db,botId:'123456789'};
  const first=sendBroadcastPhoto({sendPhoto:send} as never,'830000000',source,options,'version-one',persistent);await entered.promise;
  await expect(sendBroadcastPhoto({sendPhoto:send} as never,'830000001',source,options,'version-one',persistent)).rejects.toBeInstanceOf(TelegramMediaDeferredError);
  release.resolve();await first;await sendBroadcastPhoto({sendPhoto:send} as never,'830000002',source,options,'version-one',persistent);expect(source).toHaveBeenCalledTimes(1);expect(send.mock.calls[1]?.[1]).toBe('durable-file');
  await sendBroadcastPhoto({sendPhoto:send} as never,'830000003',source,options,'version-two',persistent);await sendBroadcastPhoto({sendPhoto:send} as never,'830000004',source,options,'version-one',{client:db,botId:'987654321'});expect(source).toHaveBeenCalledTimes(3);
  send.mockRejectedValueOnce({error_code:400});await sendBroadcastPhoto({sendPhoto:send} as never,'830000005',source,options,'version-one',persistent);expect(source).toHaveBeenCalledTimes(4);
 });
 it('does not retry an accepted photo if cache persistence or upload-lease release fails',async()=>{
  const send=vi.fn(async()=>({message_id:301,photo:[{file_id:'accepted-photo'}]}));
  const failing=new Proxy(db,{get(target,key){if(key==='telegramMediaCache')return {...db.telegramMediaCache,findUnique:db.telegramMediaCache.findUnique.bind(db.telegramMediaCache),updateMany:async()=>{throw Error('Simulated cache acknowledgement failure')}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  const sent=await sendBroadcastPhoto({sendPhoto:send} as never,users[0].telegramId,new InputFile(Buffer.from('simulated')),{caption:'Fixture'},'cache-write-failure',{client:failing,botId:'123456789'});
  expect(sent?.message_id).toBe(301);expect(send).toHaveBeenCalledTimes(1);
 });
});
