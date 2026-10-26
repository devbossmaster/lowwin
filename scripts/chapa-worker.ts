import 'dotenv/config';
import {db} from '../src/lib/db';
import {chapaAvailability} from '../src/modules/payments/chapa-provider';
import {recoverChapaCheckouts} from '../src/modules/payments/chapa';
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
try{
 if(!chapaAvailability().recoveryEnabled)throw Error('Chapa recovery is disabled. Configure the reviewed environment before starting this worker.');
 while(!stopped){try{const result=await recoverChapaCheckouts(db);if(result.checked)console.info('chapa_recovery',result)}catch{console.error('chapa_recovery_unavailable')}await new Promise(resolve=>setTimeout(resolve,2000))}
}finally{await db.$disconnect()}
