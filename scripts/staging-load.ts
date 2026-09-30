import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Bot} from 'grammy';
import {bidAuction,bidUser} from '../tests/bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction} from '../src/modules/auctions/settlement';
import {scheduleAlerts,dispatchOne} from '../src/modules/notifications/service';
import {reconcile} from '../src/modules/wallet/ledger';
const url=new URL(process.env.DATABASE_URL??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback test DB required');Object.assign(process.env,{APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true',MINI_APP_URL:'https://lowin.ngrok-free.app'});
const db=new PrismaClient();try{const count=100,auction=await bidAuction(db,{fee:1,max:1000,endDelayMs:20000}),started=performance.now();for(let n=0;n<count;n++){const userId=await bidUser(db,'1000'),telegramId=String(9900000000+n);await db.user.update({where:{id:userId},data:{telegramId}});await db.notificationPreference.create({data:{userId,telegram:true}});await db.botChat.create({data:{telegramId,chatId:telegramId}});await submitBid(db,{userId,auctionSlug:auction.slug!,amount:String(n+1),key:randomUUID()});await db.auctionFavorite.create({data:{userId,auctionId:auction.id}})}const bidsMs=performance.now()-started,scheduleStart=performance.now(),scheduled=await scheduleAlerts(db),scheduleMs=performance.now()-scheduleStart;await new Promise(r=>setTimeout(r,Math.max(0,auction.endsAt!.getTime()-Date.now()+30)));const closeStart=performance.now();await closeAuction(db,auction.id);const settlementMs=performance.now()-closeStart,bot=new Bot('123456789:fixture_token_not_a_real_bot_secret');let sends=0;bot.api.config.use(async()=>{sends++;return {ok:true,result:{message_id:sends}} as any});const dispatchStart=performance.now();let delivered=0;while(await dispatchOne(db,bot))delivered++;const dispatchMs=performance.now()-dispatchStart,drift=await reconcile(db);console.log(JSON.stringify({participants:count,bidsMs,scheduled,scheduleMs,settlementMs,transactionDeadlineMs:120000,processedOutbox:delivered,dispatchMs,externalNetworkSends:0,mockedSends:sends,drift},(_,v)=>typeof v==='bigint'?v.toString():v));if(drift.length)process.exitCode=1;
 const plan=await db.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "Outbox" WHERE state=\'PENDING\' AND "nextAttemptAt"<=clock_timestamp() ORDER BY "nextAttemptAt",id LIMIT 1');console.log(JSON.stringify({outboxPlan:plan}));
}finally{await db.$disconnect()}
