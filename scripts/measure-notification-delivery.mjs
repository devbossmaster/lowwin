import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {Bot} from 'grammy';

const url=process.env.NOTIFICATION_BENCHMARK_DATABASE_URL;
const target=new URL(url??'invalid:');
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,TELEGRAM_BOT_TOKEN:'123456789:fixture_token_not_real',MINI_APP_URL:'https://lowwin.test/telegram'});
const baseline=process.env.NOTIFICATION_BASELINE_COMMIT??'471e76929bd6a555a25152fb4ee517998423e86d';
if(!/^[0-9a-f]{7,40}$/.test(baseline))throw Error('An exact baseline commit is required');
const legacy=execFileSync('git',['show',baseline+':src/modules/notifications/service.ts'],{encoding:'utf8'}).replaceAll("from '../","from '../src/modules/").replaceAll("from './","from '../src/modules/notifications/");
mkdirSync(resolve('.local'),{recursive:true});
writeFileSync(resolve('.local/notification-load-legacy.ts'),legacy);
const {dispatchOne:oldDispatch}=await import(pathToFileURL(resolve('.local/notification-load-legacy.ts')).href);
const {dispatchBatch,expandPendingCampaigns}=await import('../src/modules/notifications/dispatch.ts');
const {queueGlobal}=await import('../src/modules/notifications/campaigns.ts');
const {installTelegramRateLimit}=await import('../src/modules/notifications/telegram-rate.ts');
const observer=new pg.Client({connectionString:url});await observer.connect();
const fixture=new PrismaClient({datasourceUrl:url});
if(await fixture.user.count())throw Error('Use a fresh, migrated disposable database for this benchmark');
const base=850000000+Math.floor(Math.random()*1000000),users=Array.from({length:31},(_,i)=>({id:randomUUID(),telegramId:String(base+i)}));
await fixture.user.createMany({data:users.map((u,i)=>({...u,name:'Benchmark recipient',role:i===30?'admin':'member'}))});
await fixture.botChat.createMany({data:users.map(u=>({telegramId:u.telegramId,chatId:u.telegramId}))});
await fixture.telegramOwnContact.createMany({data:users.map(u=>({userId:u.id,telegramId:u.telegramId,botId:'123456789',phoneCipher:'unused-isolated-cipher',phoneHash:randomUUID(),lastFour:'2904',verifiedAt:new Date(),sourceUpdateId:BigInt(u.telegramId)}))});
const output=[];
for(const mode of ['checked-in-serial','leased-concurrent']){
 await fixture.outbox.updateMany({where:{state:'PENDING'},data:{state:'SKIPPED',leaseToken:null,leaseUntil:null}});
 await fixture.telegramRateBudget.deleteMany();await fixture.telegramChatRateBudget.deleteMany();await fixture.telegramMediaCache.deleteMany();
 const pool=new URL(url);pool.searchParams.set('connection_limit',mode==='checked-in-serial'?'1':'4');
 let sqlCount=0,sqlMs=0;const db=new PrismaClient({datasourceUrl:pool.href,log:[{emit:'event',level:'query'}]});db.$on('query',event=>{sqlCount++;sqlMs+=event.duration});
 let sampleBusy=false,sampling=true,maxConnections=0,maxIdleTransaction=0,maxTransactionMs=0,completed=0,started=0,urgentQueuedAt=0,urgentStartedAt=0,firstSendAt=0;
 const beganAt=performance.now(),times=[];
 const sampler=(async()=>{while(sampling){if(!sampleBusy){sampleBusy=true;const result=await observer.query("SELECT COUNT(*)::int AS connections,COUNT(*) FILTER(WHERE state='idle in transaction')::int AS held,COALESCE(MAX(EXTRACT(EPOCH FROM clock_timestamp()-xact_start)*1000) FILTER(WHERE state='idle in transaction'),0)::float AS age FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()");const row=result.rows[0];maxConnections=Math.max(maxConnections,row.connections);maxIdleTransaction=Math.max(maxIdleTransaction,row.held);maxTransactionMs=Math.max(maxTransactionMs,row.age);sampleBusy=false}await delay(15)}})();
 const rootKey=`broadcast:load:${randomUUID()}`,enqueueStart=performance.now();
 await db.$transaction(tx=>queueGlobal(tx,rootKey,'BROADCAST',{body:'Controlled benchmark update',href:'/'}));const enqueueMs=performance.now()-enqueueStart;
 const fake=new Bot(process.env.TELEGRAM_BOT_TOKEN,{client:{timeoutSeconds:15}});
 fake.api.config.use(async(_previous,method,payload)=>{
  if(!['sendMessage','sendPhoto'].includes(method))throw Error('Unexpected transport operation');
  const now=performance.now();if(!firstSendAt)firstSendAt=now;times.push(now);
  if(String(payload.chat_id)===users[30].telegramId)urgentStartedAt=now;
  if(++started===8){urgentQueuedAt=performance.now();await fixture.outbox.create({data:{key:'load:urgent:'+randomUUID(),kind:'CONTACT_CONFIRMED',payload:{telegramId:users[30].telegramId,botId:'123456789'}}})}
  await delay(75);completed++;
  return {ok:true,result:{message_id:completed,photo:[{file_id:'simulated-photo'}]}};
 });
 if(mode==='leased-concurrent')installTelegramRateLimit(fake.api,db,process.env.TELEGRAM_BOT_TOKEN);
 if(mode==='checked-in-serial')while(completed<31){const worked=await oldDispatch(db,fake);await delay(worked?50:100)}
 else{
  await expandPendingCampaigns(db,{limit:2});
  const lane=async(priority)=>{while(completed<31){const n=await dispatchBatch(db,fake,{limit:priority?1:2,concurrency:1,priority,shouldContinue:()=>completed<31});if(!n)await delay(200)}};
  await Promise.all([lane('high'),lane(),lane(),lane()]);
 }
 sampling=false;await sampler;
 const elapsed=performance.now()-beganAt,history=await db.outbox.aggregate({where:{kind:'BROADCAST',key:{startsWith:rootKey+':'},state:'SENT'},_count:true});
 const peak=times.reduce((max,time)=>Math.max(max,times.filter(value=>value>=time&&value<time+1000).length),0);
 output.push({mode,recipients:30,urgent:1,transportLatencyMs:75,enqueueMs:+enqueueMs.toFixed(1),firstSendMs:+(firstSendAt-beganAt).toFixed(1),totalMs:+elapsed.toFixed(1),throughputPerSecond:+(31/elapsed*1000).toFixed(2),urgentQueueToSendMs:+(urgentStartedAt-urgentQueuedAt).toFixed(1),maxIdleTransaction,maxIdleTransactionMs:+maxTransactionMs.toFixed(1),maxDatabaseConnections:maxConnections,clientSqlStatements:sqlCount,clientSqlDurationMs:sqlMs,peakRollingSendsPerSecond:peak,sentRows:history._count});
 await db.$disconnect();
}
console.log(JSON.stringify({scope:'loopback PostgreSQL; intercepted Telegram only; checked-in dispatcher versus new core',baseline,results:output},null,2));
await fixture.$disconnect();await observer.end();
