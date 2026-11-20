import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PrismaClient,type Prisma,type Outbox} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {Bot,InputFile} from 'grammy';
import {randomUUID} from 'node:crypto';
import {acknowledgeDelivery,claimNotifications,claimLogicalDelivery,finishClaim} from '../src/modules/notifications/leases';
import {dispatchBatch,expandPendingCampaigns} from '../src/modules/notifications/dispatch';
import {stopBroadcast,broadcastHistory,resendBroadcast,deleteBroadcastMessages} from '../src/modules/admin/broadcast-history';
import {expandBroadcastDeletion} from '../src/modules/notifications/broadcast-delete';
import {expandCampaign,scheduleGlobalAlerts} from '../src/modules/notifications/campaigns';
import {sendBroadcastPhoto,TelegramMediaDeferredError} from '../src/modules/notifications/broadcast-photo';
import {TEST_TOKEN} from './helpers';
import {installTelegramRateLimit} from '../src/modules/notifications/telegram-rate';
import {notificationDatabaseSnapshot,notificationTimingSnapshot} from '../src/modules/notifications/diagnostics';
import {retireAuctionEndingAlerts,retireAuctionPromotions} from '../src/modules/notifications/service';
import {endingReminders,upcomingReminders} from '../src/modules/notifications/policy';
import {bidAuction} from './bid-fixtures';

const url=process.env.NOTIFICATION_DURABILITY_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable Telegram delivery: isolated database, simulated transport only',()=>{
 let db:PrismaClient,users:Array<{id:string;telegramId:string}>,messagesBefore=0;
 const maintenance=async(action:string)=>{const latest=await db.adminAudit.findFirst({orderBy:{createdAt:'desc'},select:{createdAt:true}});return db.adminAudit.create({data:{actorId:'isolated',action,target:'all',details:{},createdAt:new Date(Math.max(Date.now(),(latest?.createdAt.getTime()??0)+1))}})};
 const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};
 const fake=(send:ReturnType<typeof vi.fn>)=>({api:{sendMessage:send,sendPhoto:send,deleteMessage:send}} as unknown as Pick<Bot,'api'>);
 const job=(kind='BROADCAST',index=0,rootKey?:string)=>db.outbox.create({data:{key:rootKey?`${rootKey}:user:${users[index].id}`:`notification-durable:${randomUUID()}`,kind,payload:{recipientUserId:users[index].id,body:'Fixture update',href:'/',...(rootKey?{rootKey}:{})}}});
 beforeAll(async()=>{
  const target=new URL(url!);if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Isolated loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,TELEGRAM_BOT_TOKEN:TEST_TOKEN,MINI_APP_URL:'https://lowwin.test/telegram'});
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
  target.searchParams.set('options','-c TimeZone=Africa/Addis_Ababa');
  db=new PrismaClient({datasourceUrl:target.toString()});const base=830000000+Math.floor(Math.random()*1000000);users=Array.from({length:20},(_,i)=>({id:randomUUID(),telegramId:String(base+i)}));
  await db.user.createMany({data:users.map(u=>({...u,name:'Fixture recipient',role:'member'}))});
  await db.botChat.createMany({data:users.map(u=>({telegramId:u.telegramId,chatId:u.telegramId}))});
  await db.telegramOwnContact.createMany({data:users.map(u=>({userId:u.id,telegramId:u.telegramId,botId:'123456789',phoneCipher:'isolated-unused-cipher',phoneHash:randomUUID(),lastFour:'2904',verifiedAt:new Date(),sourceUpdateId:BigInt(u.telegramId)}))});
 },60000);
 beforeEach(async()=>{
  // This suite owns a disposable database; never configure a production URL.
  await db.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED',leaseToken:null,leaseUntil:null}});await db.telegramDeliveryLease.deleteMany();await db.telegramMediaCache.deleteMany();await maintenance('AUCTIONS_MAINTENANCE_RESUMED');messagesBefore=await db.telegramMessage.count();
  await db.botChat.updateMany({where:{telegramId:{in:users.map(u=>u.telegramId)}},data:{blocked:false}});
 });
 afterAll(async()=>{await db?.$disconnect()});
 it('queues every current reminder window once across overlapping scans with UTC audience cutoffs',async()=>{
  const ending=await Promise.all(endingReminders.map(async reminder=>{
   const auction=await bidAuction(db,{isDemo:false,endDelayMs:(reminder.minMs+reminder.maxMs)/2});
   await db.auction.update({where:{id:auction.id},data:{controlVersion:7}});
   return {id:auction.id,productId:auction.productId,categoryId:auction.categoryId,kind:reminder.kind,key:`global:${reminder.key}:${auction.id}:v7`};
  }));
  const upcoming=await Promise.all(upcomingReminders.map(async reminder=>{
   const auction=await bidAuction(db,{isDemo:false,startOffsetMs:(reminder.minMs+reminder.maxMs)/2,endDelayMs:3*86400000});
   return {id:auction.id,kind:reminder.kind,key:`global:${reminder.key}:${auction.id}`};
  }));
  const hidden=await bidAuction(db,{isDemo:false});
  await db.product.update({where:{id:hidden.productId!},data:{visible:false}});
  const tag=randomUUID(),startsAt=new Date(Date.now()-60_000);
  const demo=await db.auction.create({data:{
   code:`DEMO-CAMPAIGN-${tag}`,slug:`demo-campaign-${tag}`,status:'LIVE',isDemo:true,
   productId:ending[0].productId,categoryId:ending[0].categoryId,fulfillmentSummary:'Fixture',fulfillmentRegion:'Fixture',
   startsAt,publishedAt:startsAt,endsAt:new Date(Date.now()+600_000),
  }});
  const expected=[...ending,...upcoming];
  await maintenance('AUCTIONS_MAINTENANCE_HALTED');
  expect(await scheduleGlobalAlerts(db)).toBe(0);
  await maintenance('AUCTIONS_MAINTENANCE_RESUMED');
  const before=Date.now();
  await Promise.all([scheduleGlobalAlerts(db),scheduleGlobalAlerts(db)]);
  const rows=await db.outbox.findMany({where:{kind:'GLOBAL_CAMPAIGN'}});
  const registered=new Map(rows.map(row=>[row.key,row]));
  for(const entry of expected){
   const row=registered.get(entry.key)!;
   expect(row?.payload).toMatchObject({auctionId:entry.id,deliveryKind:entry.kind,rootKey:entry.key});
   expect((row.payload as {audienceBefore:string}).audienceBefore).toBe(row.createdAt.toISOString());
   expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
   expect(row.nextAttemptAt).toEqual(row.createdAt);
  }
  expect(rows.filter(row=>expected.some(entry=>(row.payload as {auctionId:string}).auctionId===entry.id))).toHaveLength(expected.length);
  expect(rows.some(row=>[hidden.id,demo.id].includes((row.payload as {auctionId:string}).auctionId))).toBe(false);
  expect(await scheduleGlobalAlerts(db)).toBe(0);
 });
 it('retires deadline reminders in two database statements without stopping an active send lease',async()=>{
  const now=new Date(),auctionId=randomUUID(),ending=endingReminders[0].kind;
  const jobs=Array.from({length:150},(_,index)=>({
   id:randomUUID(),key:`deadline-retirement:${auctionId}:${index}`,
   kind:index%2===0?ending:'GLOBAL_CAMPAIGN',state:'SENT',
   payload:{auctionId,deliveryKind:ending},
  }));
  const active={id:randomUUID(),key:`deadline-active:${auctionId}`,kind:ending,payload:{auctionId},leaseToken:randomUUID(),leaseUntil:new Date(now.getTime()+60000)};
  const expired={id:randomUUID(),key:`deadline-expired:${auctionId}`,kind:ending,payload:{auctionId},leaseToken:randomUUID(),leaseUntil:now};
  const other={id:randomUUID(),key:`deadline-other:${auctionId}`,kind:'GLOBAL_CAMPAIGN',payload:{auctionId,deliveryKind:'AUCTION_UPCOMING_ADDED'}};
  await db.outbox.createMany({data:[...jobs,active,expired,other]});
  const messages=jobs.map((job,index)=>({id:randomUUID(),outboxId:job.id,auctionId,chatId:users[0].telegramId,messageId:BigInt(index+1),sentAt:index<140?now:new Date(now.getTime()-47*3600000)}));
  await db.telegramMessage.createMany({data:messages});
  await db.notificationInbox.createMany({data:[...jobs,other].map(job=>({key:job.key,userId:users[0].id,kind:job.kind,title:'Fixture',body:'Fixture',href:'/'}))});
  let statements=0;
  const result=await db.$transaction(tx=>retireAuctionEndingAlerts({
   $queryRaw:<T,>(query:Prisma.Sql)=>{statements++;return tx.$queryRaw<T>(query)},
  } as Prisma.TransactionClient,auctionId,now));
  expect(result).toEqual({endingAlertsRetired:152,telegramDeletesQueued:140,telegramDeletesUnavailable:10});
  expect(statements).toBe(2);
  expect(await db.outbox.findUnique({where:{id:active.id}})).toMatchObject({state:'PENDING',leaseToken:active.leaseToken});
  expect(await db.outbox.findUnique({where:{id:expired.id}})).toMatchObject({state:'SKIPPED',lastError:'SUPERSEDED_BY_DEADLINE_CHANGE',leaseToken:null});
  expect(await db.outbox.findUnique({where:{id:other.id}})).toMatchObject({state:'PENDING'});
  expect(await db.notificationInbox.count({where:{key:{in:jobs.map(job=>job.key)}}})).toBe(0);
  expect(await db.notificationInbox.count({where:{key:other.key}})).toBe(1);
  expect(await db.telegramMessage.findUnique({where:{id:messages[149].id}})).toMatchObject({deletionState:'UNAVAILABLE',deletionRequestedAt:now,deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'});
  expect(await db.outbox.findUnique({where:{key:`telegram-delete:${messages[0].id}`}})).toMatchObject({state:'PENDING',nextAttemptAt:now});
  expect(await db.outbox.count({where:{key:{in:messages.map(message=>`telegram-delete:${message.id}`)}}})).toBe(140);
  expect(await db.$transaction(tx=>retireAuctionEndingAlerts(tx,auctionId,now))).toMatchObject({telegramDeletesQueued:0,telegramDeletesUnavailable:0});
 });
 it('keeps cancellation retirement atomic and scoped to the requested auction',async()=>{
  const auctionId=randomUUID(),now=new Date();
  const jobs=await Promise.all([auctionId,randomUUID()].map(id=>db.outbox.create({data:{key:`cancel-retirement:${id}`,kind:'AUCTION_PUBLISHED',payload:{auctionId:id}}})));
  const messages=await Promise.all(jobs.map((job,index)=>db.telegramMessage.create({data:{outboxId:job.id,auctionId:(job.payload as {auctionId:string}).auctionId,chatId:users[index].telegramId,messageId:BigInt(index+1),sentAt:now}})));
  await expect(db.$transaction(async tx=>{await retireAuctionPromotions(tx,auctionId,now);throw Error('Simulated rollback')})).rejects.toThrow('Simulated rollback');
  expect(await db.outbox.findUnique({where:{id:jobs[0].id}})).toMatchObject({state:'PENDING',lastError:null});
  expect(await db.telegramMessage.findUnique({where:{id:messages[0].id}})).toMatchObject({deletionState:'DELIVERED'});
  expect(await db.outbox.findUnique({where:{key:`telegram-delete:${messages[0].id}`}})).toBeNull();
  expect(await db.$transaction(tx=>retireAuctionPromotions(tx,auctionId,now))).toMatchObject({pendingSkipped:1,telegramDeletesQueued:1,telegramDeletesUnavailable:0});
  expect(await db.outbox.findUnique({where:{id:jobs[1].id}})).toMatchObject({state:'PENDING'});
  expect(await db.telegramMessage.findUnique({where:{id:messages[1].id}})).toMatchObject({deletionState:'DELIVERED'});
 });
 it('claims disjoint bounded batches concurrently and leaves urgent capacity plus bulk progress',async()=>{
  for(let i=0;i<12;i++)await job(i<8?'BID_ACCEPTED':'BROADCAST',i);
  const [one,two]=await Promise.all([claimNotifications(db,{limit:4}),claimNotifications(db,{limit:4})]);
  expect(new Set([...one,...two].map(r=>r.id)).size).toBe(8);expect(one).toHaveLength(4);expect(two).toHaveLength(4);
  expect(one.some(r=>r.kind==='BROADCAST')).toBe(true);expect(two.some(r=>r.kind==='BROADCAST')).toBe(true);
  expect(one.every(r=>r.leaseToken&&r.leaseUntil>new Date())).toBe(true);
  const [clock]=await db.$queryRaw<{zone:string}[]>`SELECT current_setting('TimeZone') AS zone`;
  expect(clock.zone).toBe('Africa/Addis_Ababa');
  for(const row of [...one,...two]){
   expect(row.leaseUntil.getTime()-Date.now()).toBeGreaterThan(110_000);
   expect(row.leaseUntil.getTime()-Date.now()).toBeLessThanOrEqual(120_000);
   expect(Math.abs(row.claimedAt!.getTime()-Date.now())).toBeLessThan(10_000);
  }
  expect((await notificationDatabaseSnapshot(db)).queue).toMatchObject({pending:12,due:4,inFlight:8,retrying:0});
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
  // Claim order is nextAttemptAt then UUID, not insertion order. Both jobs are
  // due, with a deliberate first recipient for this in-flight Stop barrier.
  await db.outbox.update({where:{id:row.id},data:{nextAttemptAt:new Date(0)}});await db.outbox.update({where:{id:later.id},data:{nextAttemptAt:new Date(1)}});
  const send=vi.fn(async(_chat:string)=>{began.resolve();await release.promise;return {message_id:101,photo:[{file_id:'fixture-file'}]}});
  const sending=dispatchBatch(db,fake(send),{limit:1,concurrency:1});await began.promise;
  try{
   expect(send.mock.calls[0]?.[0]).toBe(users[0].telegramId);
   const claimed=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(claimed.state).toBe('PENDING');expect(claimed.leaseToken).toBeTruthy();expect(claimed.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
   expect(await db.outbox.findUniqueOrThrow({where:{id:later.id}})).toMatchObject({state:'PENDING',leaseToken:null});
   const [activity]=await db.$queryRaw<{held:bigint}[]>`SELECT COUNT(*) AS held FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`;
   expect(Number(activity.held)).toBe(0);
   const started=performance.now(),stopped=await db.$transaction(tx=>stopBroadcast(tx,root.id));expect(performance.now()-started).toBeLessThan(500);expect(stopped.remainingStopped).toBe(1);expect(stopped.leasedAtStop).toBe(1);
   expect(await db.outbox.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({state:'PENDING',leaseToken:claimed.leaseToken});
   expect(await db.outbox.findUniqueOrThrow({where:{id:later.id}})).toMatchObject({state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'});
  }finally{release.resolve();await sending}
  expect(send).toHaveBeenCalledTimes(1);
  expect((await db.outbox.findUniqueOrThrow({where:{id:row.id}})).state).toBe('SENT');expect((await db.outbox.findUniqueOrThrow({where:{id:later.id}})).state).toBe('SKIPPED');expect(await db.telegramMessage.count()).toBe(messagesBefore+1);
  expect(await db.telegramMessage.findUniqueOrThrow({where:{outboxId:row.id}})).toMatchObject({chatId:users[0].telegramId,messageId:101n});
 });
 it('stops claimed-but-unsent work and pauses claims during maintenance without losing ownership',async()=>{
  const one=await job('BROADCAST'),two=await job('BROADCAST',1),began=deferred(),release=deferred();let running=true;
  await db.outbox.update({where:{id:one.id},data:{nextAttemptAt:new Date(0)}});await db.outbox.update({where:{id:two.id},data:{nextAttemptAt:new Date(1)}});
  const send=vi.fn(async(_chat:string)=>{began.resolve();await release.promise;return {message_id:102}});
  const sending=dispatchBatch(db,fake(send),{limit:2,concurrency:1,shouldContinue:()=>running});await began.promise;
  let inFlight=one,unsent=two;
  try{
   const recipient=send.mock.calls[0]?.[0];expect([users[0].telegramId,users[1].telegramId]).toContain(recipient);
   // A multirow UPDATE RETURNING does not promise processing order. Bind each
   // assertion to the request that actually entered HTTP, under its live claim.
   if(recipient===users[1].telegramId){inFlight=two;unsent=one}
   const claims=await db.outbox.findMany({where:{id:{in:[one.id,two.id]}}});expect(claims).toHaveLength(2);expect(claims.every(row=>row.state==='PENDING'&&row.leaseToken&&row.leaseUntil!.getTime()>Date.now())).toBe(true);
   running=false;
  }finally{release.resolve();await sending}
  expect(send).toHaveBeenCalledTimes(1);expect(await db.outbox.findUniqueOrThrow({where:{id:unsent.id}})).toMatchObject({state:'PENDING',lastError:'WORKER_STOPPING',leaseToken:null});
  expect((await db.outbox.findUniqueOrThrow({where:{id:inFlight.id}})).state).toBe('SENT');
  expect(await db.telegramMessage.findUniqueOrThrow({where:{outboxId:inFlight.id}})).toMatchObject({chatId:send.mock.calls[0][0],messageId:102n});
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
  const row=await job('BROADCAST');const send=vi.fn(async()=>({message_id:103}));
  const wrapped=new Proxy(db,{get(target,key){
   if(key==='$queryRaw')return async(query:TemplateStringsArray|Prisma.Sql,...values:unknown[])=>{
    if(('strings' in query?query.strings:query).join('').includes('WITH acknowledged AS'))throw Error('Simulated acknowledgement disconnect');
    return target.$queryRaw(query,...values);
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  await dispatchBatch(wrapped,fake(send),{limit:1});
  const saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});expect(saved).toMatchObject({state:'PENDING',lastError:'ACKNOWLEDGEMENT_UNCERTAIN'});expect(saved.leaseToken).toBeTruthy();
  await dispatchBatch(db,fake(send),{limit:1});expect(send).toHaveBeenCalledTimes(1);
 });
 it('records an ordinary delivery once under the current lease',async()=>{
  const row=await job('BROADCAST'),[old]=await claimNotifications(db,{limit:1});
  await db.outbox.update({where:{id:row.id},data:{leaseUntil:new Date(0)}});
  const [current]=await claimNotifications(db,{limit:1});
  const delivered={chatId:users[0].telegramId,messageId:107};
  expect(await acknowledgeDelivery(db,old,delivered)).toBe(false);
  expect(await db.telegramMessage.findUnique({where:{outboxId:row.id}})).toBeNull();
  expect(await acknowledgeDelivery(db,current,delivered)).toBe(true);
  expect(await acknowledgeDelivery(db,current,{...delivered,messageId:108})).toBe(false);
  expect(await db.outbox.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({state:'SENT',attempts:1,leaseToken:null});
  expect(await db.telegramMessage.findUniqueOrThrow({where:{outboxId:row.id}})).toMatchObject({chatId:delivered.chatId,messageId:107n});
 });
 it('renews a nearly expired owner before HTTP so another worker cannot reclaim the in-flight send',async()=>{
  const row=await job('BROADCAST'),began=deferred(),release=deferred();let shortened=false;
  const original=db.$transaction.bind(db);let transactions=0;
  const nearExpiry=new Proxy(db,{get(target,key){if(key==='$transaction')return async(...args:Parameters<typeof db.$transaction>)=>{if(++transactions===2&&!shortened){shortened=true;await db.outbox.update({where:{id:row.id},data:{leaseUntil:new Date(Date.now()+10_000)}})}return (original as (...input:unknown[])=>unknown)(...args)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  let observedLease=0;const send=vi.fn(async()=>{const saved=await db.outbox.findUniqueOrThrow({where:{id:row.id}});observedLease=saved.leaseUntil!.getTime()-Date.now();began.resolve();await release.promise;return {message_id:104}});
  const sending=dispatchBatch(nearExpiry as unknown as PrismaClient,fake(send),{limit:1});await Promise.race([began.promise,sending.then(()=>{throw Error('Expected a renewed lease before simulated HTTP')})]);
  try{expect(observedLease).toBeGreaterThan(90_000);expect(await claimNotifications(db,{limit:1})).toEqual([])}finally{release.resolve();await sending}expect(send).toHaveBeenCalledTimes(1);
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
 it('resends original content into a fresh idempotent campaign and includes linked bot users without shared contact',async()=>{
  const originalKey=`broadcast:${randomUUID()}`,original=await db.outbox.create({data:{key:originalKey,kind:'GLOBAL_CAMPAIGN',state:'SENT',payload:{deliveryKind:'BROADCAST',rootKey:originalKey,body:'Beta service update',href:'/',buttonLabel:'Open service',imagePath:'/images/lowwin-demo-headphones.webp'}}}),resendKey=`broadcast:${randomUUID()}`;
  const [one,two]=await Promise.all([db.$transaction(tx=>resendBroadcast(tx,original.id,resendKey)),db.$transaction(tx=>resendBroadcast(tx,original.id,resendKey))]);expect(one.id).toBe(two.id);
  const copy=await db.outbox.findUniqueOrThrow({where:{id:one.id}});expect(copy.payload).toMatchObject({parentCampaignId:original.id,body:'Beta service update',href:'/',buttonLabel:'Open service',imagePath:'/images/lowwin-demo-headphones.webp'});expect(await db.outbox.findUniqueOrThrow({where:{id:original.id}})).toEqual(original);
  expect((await db.$transaction(tx=>resendBroadcast(tx,original.id,`broadcast:${randomUUID()}`))).id).not.toBe(one.id);
  const contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:users[19].id}});await db.telegramOwnContact.delete({where:{userId:users[19].id}});
  try{await db.$transaction(tx=>expandCampaign(tx,copy));expect(await db.outbox.findUnique({where:{key:`${resendKey}:user:${users[19].id}`}})).toMatchObject({kind:'BROADCAST',state:'PENDING'});}finally{await db.telegramOwnContact.create({data:contact})}
 });
 it('stops sends and deletes only recorded campaign messages, preserving late acknowledgements and expired audit history',async()=>{
  const originalKey=`broadcast:${randomUUID()}`,original=await db.outbox.create({data:{key:originalKey,kind:'GLOBAL_CAMPAIGN',state:'SENT',payload:{deliveryKind:'BROADCAST',rootKey:originalKey,body:'Fixture deletion',href:'/'}}});
  const fresh=await job('BROADCAST',0,originalKey),expired=await job('BROADCAST',1,originalKey),late=await job('BROADCAST',2,originalKey),token=randomUUID(),leaseUntil=new Date(Date.now()+120000);
  await db.outbox.updateMany({where:{id:{in:[fresh.id,expired.id]}},data:{state:'SENT',sentAt:new Date()}});
  await db.telegramMessage.create({data:{outboxId:fresh.id,chatId:users[0].telegramId,messageId:501n}});await db.telegramMessage.create({data:{outboxId:expired.id,chatId:users[1].telegramId,messageId:502n,sentAt:new Date(Date.now()-49*3600000)}});
  const claimed=await db.outbox.update({where:{id:late.id},data:{leaseToken:token,leaseUntil}});
  const deletion=await db.$transaction(tx=>deleteBroadcastMessages(tx,original.id)),control=await db.outbox.findUniqueOrThrow({where:{id:String(deletion.deletionJobId)}});
  await db.$transaction(tx=>expandBroadcastDeletion(tx,control));expect(await db.outbox.findUniqueOrThrow({where:{id:control.id}})).toMatchObject({state:'PENDING',lastError:'WAITING_FOR_SEND_ACKNOWLEDGEMENTS'});
  await finishClaim(db,{...claimed,leaseToken:token,leaseUntil},{state:'SENT',sentAt:new Date()},{chatId:users[2].telegramId,messageId:503});
  await db.$transaction(tx=>expandBroadcastDeletion(tx,control));expect(await db.outbox.findUniqueOrThrow({where:{id:control.id}})).toMatchObject({state:'SENT'});
  const remove=vi.fn(async()=>true);await dispatchBatch(db,{api:{deleteMessage:remove}} as unknown as Pick<Bot,'api'>,{limit:10,concurrency:2});expect(remove).toHaveBeenCalledTimes(2);
  const history=await broadcastHistory(db,{page:1,q:originalKey});expect(history.items[0]).toMatchObject({state:'STOPPED',deletion:{deleted:2,pending:0,failed:0,unavailable:1,preparing:false}});
  expect(await db.outbox.findUniqueOrThrow({where:{id:original.id}})).toMatchObject({payload:original.payload});expect(await db.telegramMessage.findUniqueOrThrow({where:{outboxId:expired.id}})).toMatchObject({deletionState:'UNAVAILABLE',deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'});
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
