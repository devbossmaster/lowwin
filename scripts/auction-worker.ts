import 'dotenv/config';
import { setTimeout } from 'node:timers/promises';
// Serial worker: reserve one pool connection, leaving capacity for web sign-in.
if(process.env.DATABASE_URL){const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connection_limit','1');url.searchParams.set('pool_timeout','20');process.env.DATABASE_URL=url.toString()}
const [{db},{processDueAuction}]=await Promise.all([import('../src/lib/db'),import('../src/modules/auctions/settlement')]);

let running=true;
process.on('SIGTERM',()=>{running=false});process.on('SIGINT',()=>{running=false});
const once=process.argv.includes('--once');
console.log('Lowwin auction settlement worker started. External notification delivery is disabled.');
try {
  do {
    try {
      const result=await processDueAuction(db);
      console.log(JSON.stringify(result));
      if(!once&&result.status!=='settled')await setTimeout(1000);
    }catch {console.error('Auction database unavailable; retrying.');if(once){process.exitCode=1;break}await setTimeout(5000)}
  }while(running&&!once);
}finally {await db.$disconnect()}
