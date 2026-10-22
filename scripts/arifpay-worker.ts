import 'dotenv/config';
import {db} from '../src/lib/db';
import {arifPayAvailability} from '../src/modules/payments/arifpay-provider';
import {recoverArifPayCheckouts} from '../src/modules/payments/arifpay';
let stopped=false;
process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
try{
 if(!arifPayAvailability().recoveryEnabled)throw Error('ArifPay recovery is disabled. Complete merchant and release review first.');
 while(!stopped){try{const result=await recoverArifPayCheckouts(db);if(result.checked)console.info('arifpay_recovery',result)}catch{console.error('arifpay_recovery_unavailable')}await new Promise(resolve=>setTimeout(resolve,2000))}
}finally{await db.$disconnect()}
