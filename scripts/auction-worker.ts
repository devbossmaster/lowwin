import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
import { db } from '../src/lib/db';
import { processDueAuction } from '../src/modules/auctions/settlement';

let running=true;
process.on('SIGTERM',()=>{running=false});process.on('SIGINT',()=>{running=false});
const once=process.argv.includes('--once');
console.log('Lowin auction settlement worker started. External notification delivery is disabled.');
try {
  do {
    try {
      const result=await processDueAuction(db);
      console.log(JSON.stringify(result));
      if(!once&&result.status!=='settled')await setTimeout(1000);
    }catch {console.error('Auction database unavailable; retrying.');if(once){process.exitCode=1;break}await setTimeout(5000)}
  }while(running&&!once);
}finally {await db.$disconnect()}
