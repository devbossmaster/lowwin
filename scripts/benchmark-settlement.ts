import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {bidAuction,bidUser} from '../tests/bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction} from '../src/modules/auctions/settlement';
import {reconcile} from '../src/modules/wallet/ledger';

// Never load .env. This creates DEMO fixtures only in an explicit disposable DB.
const url=new URL(process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Explicit loopback _test database required');
url.searchParams.set('connection_limit','5');
Object.assign(process.env,{DATABASE_URL:url.href,DIRECT_URL:url.href,APP_ENV:'local',NODE_ENV:'test',DEV_POINTS_ENABLED:'true'});
const db=new PrismaClient({datasourceUrl:url.href});
const percentile=(values:number[],fraction:number)=>Math.round([...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1]*100)/100;
const results=[];
try{
 for(const ruleVersion of ['lowest-unique-v1','lowest-unique-v2']){
  const users:string[]=[];for(let i=0;i<100;i++)users.push(await bidUser(db,'1000'));
  const auction=await bidAuction(db,{ruleVersion,fee:1,max:1000,endDelayMs:30000});
  let next=0;const times:number[]=[],started=performance.now();
  await Promise.all(Array.from({length:5},async()=>{while(next<users.length){const index=next++,at=performance.now();await submitBid(db,{userId:users[index],auctionSlug:auction.slug!,amount:String(index+1),key:randomUUID()});times.push(performance.now()-at)}}));
  const bidWallMs=performance.now()-started;
  const [{now}]=await db.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-now.getTime()+30)));
  const closing=performance.now();await closeAuction(db,auction.id);const settlementMs=performance.now()-closing;
  const replay=performance.now();await closeAuction(db,auction.id);const retryMs=performance.now()-replay;
  const settlement=await db.auctionSettlement.findUniqueOrThrow({where:{auctionId:auction.id}}),drift=await reconcile(db);
  if(drift.length||settlement.outcome!=='WINNER'||settlement.winningPoints!==1n)throw Error('Load outcome or reconciliation mismatch');
  results.push({ruleVersion,participants:100,concurrency:5,poolLimit:5,bidWallMs:Math.round(bidWallMs),bidP50Ms:percentile(times,.5),bidP95Ms:percentile(times,.95),settlementMs:Math.round(settlementMs),idempotentRetryMs:Math.round(retryMs),drift:drift.length});
 }
 const report={at:new Date().toISOString(),target:'loopback PostgreSQL; DEMO fixtures; service calls, not HTTP or Telegram',results};
 mkdirSync('test-results/release',{recursive:true});writeFileSync('test-results/release/settlement-load.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await db.$disconnect()}
