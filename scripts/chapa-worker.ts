import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {chapaWorkerConfiguration} from '../src/modules/payments/chapa-readiness';
import {installTelegramRateLimit} from '../src/modules/notifications/telegram-rate';
const configuration=chapaWorkerConfiguration(process.env);
console.info(JSON.stringify(configuration));
if(!configuration.recoveryEnabled)throw Error('Chapa webhook event processing is disabled. Fix missingPrerequisites in the chapa_worker_configuration log and redeploy this worker.');
// Report configuration before loading any database or financial runtime module.
const [{db},{recoverChapaCheckouts},{processChapaEvents},{dispatchOne},{chapaReceiptKind},{Bot},{reconcileDirectCheckouts},{reconcileInlineCheckouts}]=await Promise.all([
 import('../src/lib/db'),import('../src/modules/payments/chapa'),import('../src/modules/payments/chapa-events'),
 import('../src/modules/notifications/service'),import('../src/modules/notifications/chapa-receipt'),import('grammy'),import('../src/modules/payments/chapa-direct'),import('../src/modules/payments/chapa-inline'),
]);
const {expireDepositBonusLots}=await import('../src/modules/wallet/deposit-bonus');
// Credit is already committed before its outbox receipt is eligible. This worker
// handles only those receipts; campaign scheduling and other jobs stay separate.
let receiptBot:InstanceType<typeof Bot>|null=null;
try{if(process.env.TELEGRAM_BOT_TOKEN){const candidate=new Bot(process.env.TELEGRAM_BOT_TOKEN,{client:{timeoutSeconds:15}});installTelegramRateLimit(candidate.api,db,process.env.TELEGRAM_BOT_TOKEN);receiptBot=candidate}}catch{console.error('chapa_receipt_rate_configuration_invalid')}
console.info('chapa_receipt_delivery_configuration',{enabled:!!receiptBot});
const shutdown=new AbortController();
process.on('SIGTERM',()=>shutdown.abort());
process.on('SIGINT',()=>shutdown.abort());
const running=()=>!shutdown.signal.aborted;

async function runLoop(work:()=>Promise<void|boolean>,errorEvent:string,idleMs:number,activeMs=idleMs){
 while(running()){
  let worked:void|boolean=undefined;
  try{worked=await work()}catch{console.error(errorEvent)}
  if(running()){
   try{await delay(worked?activeMs:idleMs,undefined,{signal:shutdown.signal})}
   catch(error){if(running())throw error}
  }
 }
}

async function reconcilePayments(){
 const events=await processChapaEvents(db);
 if(events.checked)console.info('chapa_events',events);
 if(running()&&configuration.v2RecoveryEnabled){
  const direct=await reconcileDirectCheckouts(db);
  if(direct.checked)console.info('chapa_direct_reconciliation',direct);
 }
 if(running()&&configuration.v2RecoveryEnabled){
  const inline=await reconcileInlineCheckouts(db);
  if(inline.checked)console.info('chapa_inline_reconciliation',inline);
 }
 if(running()&&(configuration.v1RecoveryEnabled||configuration.v2RecoveryEnabled&&configuration.legacySweepEnabled)){
  const legacy=await recoverChapaCheckouts(db);
  if(legacy.checked)console.info('chapa_legacy_recovery',legacy);
 }
}

try{
 // Receipt delivery may wait for Telegram or its rate limiter. Keep provider
 // checks running on their own cadence with one provider reconciliation loop.
 const bot=receiptBot;
 await Promise.all([
  runLoop(reconcilePayments,'chapa_event_processing_unavailable',2000),
  ...(bot?[runLoop(async()=>{
   const dispatched=await dispatchOne(db,bot,{kind:chapaReceiptKind});
   if(dispatched)console.info('chapa_receipt_dispatched');
   return dispatched;
  },'chapa_receipt_delivery_unavailable',2000,100)]:[]),
  runLoop(async()=>{
   const expired=await expireDepositBonusLots(db,20);
   if(expired.expired)console.info('deposit_bonus_expiry',expired);
  },'deposit_bonus_expiry_unavailable',30000),
 ]);
}finally{await db.$disconnect()}
