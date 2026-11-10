import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {Bot} from 'grammy';

// All Telegram HTTP is intercepted below. This script never reads .env and
// refuses remote, populated or non-test databases. No live campaign is touched.
const url=process.env.NOTIFICATION_BENCHMARK_DATABASE_URL,target=new URL(url??'invalid:');
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Fresh migrated loopback _test database required');
Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,TELEGRAM_BOT_TOKEN:'123456789:fixture_token_not_real',MINI_APP_URL:'https://lowwin.test/telegram',NOTIFICATION_SEND_CONCURRENCY:'4',TELEGRAM_SENDS_PER_SECOND:'20',TELEGRAM_BULK_SENDS_PER_SECOND:'16',TELEGRAM_PRIVATE_CHAT_INTERVAL_MS:'1000',TELEGRAM_GROUP_CHAT_INTERVAL_MS:'3000',TELEGRAM_RATE_MAX_WAIT_MS:'10000'});
const baseline=process.env.NOTIFICATION_BASELINE_COMMIT??'0ca25b2551cfdae3a601af4b5bbb881ffc74549a';
if(!/^[0-9a-f]{40}$/.test(baseline))throw Error('Exact 40-character baseline commit required');
const folder=resolve('.local/notification-latency-baseline');mkdirSync(folder,{recursive:true});
for(const name of ['dispatch','telegram-rate','broadcast-photo']){
 let code=execFileSync('git',['show',`${baseline}:src/modules/notifications/${name}.ts`],{encoding:'utf8'});
 code=code.replaceAll("from '../","from '../../src/modules/").replace(/from '\.\/([^']+)'/g,(_all,part)=>`from '${['telegram-rate','broadcast-photo'].includes(part)?'./':'../../src/modules/notifications/'}${part}'`);
 if(name==='dispatch'){
  code="import {recordNotificationTiming,recordNotificationAccepted,recordNotificationUncertain,timeNotification} from '../../src/modules/notifications/diagnostics';\n"+code;
  code=code.replace('async function beforeSend(','async function unmeasuredGate(').replace('async function getContent',"async function beforeSend(...args:Parameters<typeof unmeasuredGate>){return timeNotification('gate',()=>unmeasuredGate(...args))}\nasync function getContent");
  code=code.replace('claimLogicalDelivery,finishClaim,','claimLogicalDelivery,finishClaim as unmeasuredFinishClaim,');
  code=code.replace('type BotApi=',"const finishClaim=(...args:Parameters<typeof unmeasuredFinishClaim>)=>timeNotification('acknowledgement',()=>unmeasuredFinishClaim(...args));\ntype BotApi=");
  code=code.replace(' let recipientTelegramId:', ' const preparingAt=performance.now();\n let recipientTelegramId:');
  code=code.replaceAll('const sent=await withTelegramSendPolicy',"recordNotificationTiming('preparation',performance.now()-preparingAt);\n  const sent=await withTelegramSendPolicy");
  code=code.replaceAll('acceptedByTelegram=true;', 'acceptedByTelegram=true;recordNotificationAccepted();');
  code=code.replace('if(acceptedByTelegram){','if(acceptedByTelegram){recordNotificationUncertain();');
  code=code.replace('const rows=await claimNotifications(client,options)',"const rows=await timeNotification('claim',()=>claimNotifications(client,options))");
  code=code.replace('sendBroadcastPhoto(bot.api,chat.chatId,preparePhoto,',"sendBroadcastPhoto(bot.api,chat.chatId,()=>timeNotification('mediaPreparation',preparePhoto),");
 }else if(name==='telegram-rate'){
  code="import {recordNotificationTiming,timeNotification} from '../../src/modules/notifications/diagnostics';\n"+code;
  code=code.replace('  while(true){','  try{while(true){').replace('  // Quota polling',"  }finally{recordNotificationTiming('rate',performance.now()-started)}\n  // Quota polling");
  code=code.replace('await prev(method,payload,signal)',"await timeNotification('http',()=>prev(method,payload,signal))");
 }
 writeFileSync(resolve(folder,name+'.ts'),code);
}

const {queueGlobal}=await import('../src/modules/notifications/campaigns.ts');
const {notificationTimingSnapshot,notificationDatabaseSnapshot}=await import('../src/modules/notifications/diagnostics.ts');
const {broadcastHistory}=await import('../src/modules/admin/broadcast-history.ts');
const observer=new pg.Client({connectionString:url});await observer.connect();
const fixture=new PrismaClient({datasourceUrl:url});
if(await fixture.user.count())throw Error('Database already contains users; create a fresh test database');
const users=Array.from({length:1500},(_,index)=>({id:randomUUID(),telegramId:String(880000000+index)}));
await fixture.user.createMany({data:users.map(u=>({...u,name:'Simulated recipient',role:'member'}))});
await fixture.botChat.createMany({data:users.map(u=>({telegramId:u.telegramId,chatId:u.telegramId}))});
const urgent={id:randomUUID(),telegramId:'889999999'};
await fixture.user.create({data:{...urgent,name:'Simulated personal recipient',role:'admin'}});
await fixture.botChat.create({data:{telegramId:urgent.telegramId,chatId:urgent.telegramId}});
await fixture.telegramOwnContact.create({data:{userId:urgent.id,telegramId:urgent.telegramId,botId:'123456789',phoneCipher:'isolated-unused-cipher',phoneHash:randomUUID(),lastFour:'0000',verifiedAt:new Date(),sourceUpdateId:BigInt(urgent.telegramId)}});
const results=[];
for(const mode of ['baseline','optimized']){
 await fixture.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED',leaseToken:null,leaseUntil:null}});
 await fixture.telegramMediaCache.deleteMany();await fixture.telegramChatRateBudget.deleteMany();await fixture.telegramRateBudget.deleteMany();
 const module=mode==='baseline'?await import(pathToFileURL(resolve(folder,'dispatch.ts')).href):await import('../src/modules/notifications/dispatch.ts');
 const rate=mode==='baseline'?await import(pathToFileURL(resolve(folder,'telegram-rate.ts')).href):await import('../src/modules/notifications/telegram-rate.ts');
 const pool=new URL(url);pool.searchParams.set('connection_limit','4');pool.searchParams.set('pool_timeout','20');
 let statements=0,sqlDurationMs=0;
 const db=new PrismaClient({datasourceUrl:pool.href,log:[{emit:'event',level:'query'}]});db.$on('query',event=>{statements++;sqlDurationMs+=event.duration});
 const rootKey=`broadcast:latency:${mode}:${randomUUID()}`;
 await db.$transaction(tx=>queueGlobal(tx,rootKey,'BROADCAST',{body:'Simulated 60-second window',href:'/'}));
 while(await module.expandPendingCampaigns(db,{limit:10}));
 const root=await fixture.outbox.findUniqueOrThrow({where:{key:rootKey}});
 const fake=new Bot(process.env.TELEGRAM_BOT_TOKEN,{client:{timeoutSeconds:15}});
 const starts=[],personal=[],queueAges=[],urgentQueued=new Map();let completed=0;
 let beganAt=0,deadline=0;
 fake.api.config.use(async(_prev,method,payload)=>{
  if(!['sendPhoto','sendMessage'].includes(method))throw Error('Unexpected simulated transport call');
  const now=performance.now();starts.push(now);
  if(String(payload.chat_id)===urgent.telegramId){const pending=[...urgentQueued.values()].find(value=>!value.sent);if(pending){pending.sent=true;personal.push(now-pending.at)}}
  await delay(75);completed++;
  return {ok:true,result:{message_id:completed,photo:[{file_id:'simulated-immutable-file'}]}};
 });rate.installTelegramRateLimit(fake.api,db,process.env.TELEGRAM_BOT_TOKEN);
 // The real worker reserves one personal lane and has three independently
 // refilling general lanes. Both modes use identical pools, rates and HTTP.
 notificationTimingSnapshot(true);statements=0;sqlDurationMs=0;beganAt=performance.now();deadline=beganAt+60_000;
 let sampling=true,maxConnections=0,maxActive=0,maxWaiting=0,maxIdleInTransaction=0,maxIdleTransactionMs=0,snapshotAt=0,adminSample;
 const sampler=(async()=>{while(sampling){
  const result=await observer.query("SELECT COUNT(*)::int AS connections,COUNT(*) FILTER(WHERE state='active')::int AS active,COUNT(*) FILTER(WHERE state='active' AND wait_event IS NOT NULL)::int AS waiting,COUNT(*) FILTER(WHERE state='idle in transaction')::int AS idle,COALESCE(MAX(EXTRACT(EPOCH FROM clock_timestamp()-xact_start)*1000) FILTER(WHERE state='idle in transaction'),0)::float AS age FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()");
  const r=result.rows[0];maxConnections=Math.max(maxConnections,r.connections);maxActive=Math.max(maxActive,r.active);maxWaiting=Math.max(maxWaiting,r.waiting);maxIdleInTransaction=Math.max(maxIdleInTransaction,r.idle);maxIdleTransactionMs=Math.max(maxIdleTransactionMs,r.age);
  if(performance.now()-beganAt>30_000&&!adminSample){snapshotAt=performance.now();adminSample=(await broadcastHistory(fixture,{page:1,q:''})).items.find(row=>row.id===root.id)}
  const age=await observer.query('SELECT COALESCE(MAX(EXTRACT(EPOCH FROM clock_timestamp()-"createdAt")*1000),0)::float AS age FROM "Outbox" WHERE state=\'PENDING\' AND kind=\'BROADCAST\' AND starts_with(key,$1)',[rootKey+':']);queueAges.push(age.rows[0].age);
  await delay(100);
 }})();
 const personalWork=(async()=>{for(let index=0;index<12;index++){
  await delay(Math.max(0,beganAt+index*5000-performance.now()));if(performance.now()>=deadline)break;
  const key=`latency:urgent:${mode}:${index}`;urgentQueued.set(key,{at:performance.now(),sent:false});
  await fixture.outbox.create({data:{key,kind:'CONTACT_CONFIRMED',payload:{telegramId:urgent.telegramId,botId:'123456789'}}});
 }})();
 const lane=async priority=>{while(performance.now()<deadline){const count=await module.dispatchBatch(db,fake,{limit:priority?1:2,concurrency:1,priority,shouldContinue:()=>performance.now()<deadline});if(!count)await delay(200)}};
 await Promise.all([lane('high'),lane(),lane(),lane(),personalWork]);sampling=false;await sampler;
 const timings=notificationTimingSnapshot(),database=await notificationDatabaseSnapshot(fixture),history=(await broadcastHistory(fixture,{page:1,q:''})).items.find(row=>row.id===root.id);
 const sentInWindow=starts.filter(t=>t<deadline).length,peak=starts.reduce((max,time)=>Math.max(max,starts.filter(t=>t>=time&&t<time+1000).length),0);
 const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return +(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0).toFixed(1)};
 results.push({mode,windowSeconds:60,transportLatencyMs:75,sendConcurrency:4,botPerSecond:20,bulkPerSecond:16,sql:{statements,durationMs:sqlDurationMs,statementsPerAccepted:+(statements/timings.accepted).toFixed(2)},sendsPerSecond:+(sentInWindow/60).toFixed(2),httpStarts:sentInWindow,peakRollingStarts:peak,personal:{count:personal.length,p50QueueToHttpMs:percentile(personal,.5),p95QueueToHttpMs:percentile(personal,.95)},oldestPendingQueueAgeMs:{p50:percentile(queueAges,.5),p95:percentile(queueAges,.95)},pool:{configuredDeliveryConnections:4,databaseWideMaxConnections:maxConnections,databaseWideMaxActive:maxActive,databaseWideMaxWaiting:maxWaiting,maxIdleInTransaction,maxIdleTransactionMs:+maxIdleTransactionMs.toFixed(1)},timings,database,admin:{sampleAgeMs:Math.round(performance.now()-snapshotAt),sampleSent:adminSample?.sent,finalSent:history.sent,sentSinceSample:history.sent-(adminSample?.sent??0),finalPending:history.pending,finalRetrying:history.retrying,finalInFlight:history.inFlight,finalSkipped:history.skipped,finalFailed:history.failed}});
 await db.$disconnect();console.info('notification_latency_window_complete',{mode,sendsPerSecond:results.at(-1).sendsPerSecond});
}
const report={scope:'local loopback PostgreSQL; intercepted Telegram; identical 60s windows',baseline,results};
const output=resolve('.local/notification-latency-results.json');writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
await fixture.$disconnect();await observer.end();
