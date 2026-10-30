import 'dotenv/config';
import {chapaWorkerConfiguration} from '../src/modules/payments/chapa-readiness';
const configuration=chapaWorkerConfiguration(process.env);
console.info(JSON.stringify(configuration));
if(!configuration.recoveryEnabled)throw Error('Chapa webhook event processing is disabled. Fix missingPrerequisites in the chapa_worker_configuration log and redeploy this worker.');
// Report configuration before loading any database or financial runtime module.
const [{db},{recoverChapaCheckouts},{processChapaEvents},{dispatchOne},{chapaReceiptKind},{Bot}]=await Promise.all([
 import('../src/lib/db'),import('../src/modules/payments/chapa'),import('../src/modules/payments/chapa-events'),
 import('../src/modules/notifications/service'),import('../src/modules/notifications/chapa-receipt'),import('grammy'),
]);
// Credit is already committed before its outbox receipt is eligible. This worker
// handles only those receipts; campaign scheduling and other jobs stay separate.
let receiptBot:InstanceType<typeof Bot>|null=null;
try{if(process.env.TELEGRAM_BOT_TOKEN)receiptBot=new Bot(process.env.TELEGRAM_BOT_TOKEN,{client:{timeoutSeconds:15}})}catch{}
console.info('chapa_receipt_delivery_configuration',{enabled:!!receiptBot});
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
try{
 while(!stopped){
  try{const result=await processChapaEvents(db);if(result.checked)console.info('chapa_events',result);if(process.env.CHAPA_LEGACY_SWEEP_ENABLED==='true'){const legacy=await recoverChapaCheckouts(db);if(legacy.checked)console.info('chapa_legacy_recovery',legacy)}}catch{console.error('chapa_event_processing_unavailable')}
  let dispatched=false;
  if(!stopped&&receiptBot)try{dispatched=await dispatchOne(db,receiptBot,{kind:chapaReceiptKind});if(dispatched)console.info('chapa_receipt_dispatched')}catch{console.error('chapa_receipt_delivery_unavailable')}
  await new Promise(resolve=>setTimeout(resolve,dispatched?100:2000));
 }
}finally{await db.$disconnect()}
