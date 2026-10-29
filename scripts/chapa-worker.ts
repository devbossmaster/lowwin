import 'dotenv/config';
import {db} from '../src/lib/db';
import {chapaAvailability} from '../src/modules/payments/chapa-provider';
import {recoverChapaCheckouts} from '../src/modules/payments/chapa';
import {processChapaEvents} from '../src/modules/payments/chapa-events';
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
try{
 if(!chapaAvailability().recoveryEnabled)throw Error('Chapa webhook event processing is disabled. Match the web app Chapa configuration and set CHAPA_RECOVERY_ENABLED=true. Keep CHAPA_LEGACY_SWEEP_ENABLED=false to disable the old sweep.');
 while(!stopped){try{const result=await processChapaEvents(db);if(result.checked)console.info('chapa_events',result);if(process.env.CHAPA_LEGACY_SWEEP_ENABLED==='true'){const legacy=await recoverChapaCheckouts(db);if(legacy.checked)console.info('chapa_legacy_recovery',legacy)}}catch{console.error('chapa_event_processing_unavailable')}await new Promise(resolve=>setTimeout(resolve,2000))}
}finally{await db.$disconnect()}
