import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {Bot} from 'grammy';
import {scheduleAlerts,dispatchBatch,expandPendingCampaigns} from '../src/modules/notifications/service';
import {processOneVerifyRequest} from '../src/modules/payments/service';
import {notificationSettings} from '../src/modules/notifications/settings';
import {installTelegramRateLimit} from '../src/modules/notifications/telegram-rate';
import {runNotificationLanes} from '../src/modules/notifications/worker-lanes';

const settings=notificationSettings();
const client=(connections:number)=>{const database=new URL(process.env.DATABASE_URL!);database.searchParams.set('connection_limit',String(connections));database.searchParams.set('pool_timeout','20');return new PrismaClient({datasourceUrl:database.href})};
// Separate small pools prevent slow legacy verification from consuming the
// delivery/scheduling connection. Default total: 4+2+1 = seven connections.
const deliveryDb=client(settings.NOTIFICATION_SEND_CONCURRENCY),jobsDb=client(2),verificationDb=client(1);
const bot=new Bot(process.env.TELEGRAM_BOT_TOKEN!,{client:{timeoutSeconds:15}});
installTelegramRateLimit(bot.api,deliveryDb,process.env.TELEGRAM_BOT_TOKEN!);
const shutdown=new AbortController();
process.on('SIGINT',()=>shutdown.abort());process.on('SIGTERM',()=>shutdown.abort());
const shouldContinue=()=>!shutdown.signal.aborted;

console.info('notification_worker_configuration',{concurrency:settings.NOTIFICATION_SEND_CONCURRENCY,personalLanes:1,botRate:settings.TELEGRAM_SENDS_PER_SECOND,bulkRate:settings.TELEGRAM_BULK_SENDS_PER_SECOND,maximumDatabaseConnections:settings.NOTIFICATION_SEND_CONCURRENCY+3,paidBroadcasts:false});
try{
 await runNotificationLanes({
  schedule:async()=>{await scheduleAlerts(jobsDb);if(shouldContinue())await jobsDb.fulfillmentCase.updateMany({where:{contactDeleteAt:{lte:new Date()},contactCipher:{not:null}},data:{contactCipher:null}});return true},
  expand:()=>shouldContinue()?expandPendingCampaigns(jobsDb,{limit:settings.NOTIFICATION_EXPANSION_BATCHES}):Promise.resolve(0),
  verify:()=>shouldContinue()?processOneVerifyRequest(verificationDb):Promise.resolve(false),
  // Independent lanes immediately refill after completion. A slow bulk HTTP
  // call cannot impose a barrier on every other lane or the personal lane.
  send:priority=>shouldContinue()?dispatchBatch(deliveryDb,bot,{limit:priority?1:2,concurrency:1,priority,shouldContinue}):Promise.resolve(0),
 },settings,shutdown.signal,lane=>console.error('notification_lane_retry',{lane}));
}finally{await Promise.all([deliveryDb.$disconnect(),jobsDb.$disconnect(),verificationDb.$disconnect()])}
