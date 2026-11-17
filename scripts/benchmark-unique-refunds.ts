/** Explicit disposable performance probe; never connects to a remote database. */
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {bidAuction} from '../tests/bid-fixtures';
import {verifiedReferralUser} from '../tests/referral-fixtures';
import {creditDevelopmentPoints,reconcile} from '../src/modules/wallet/ledger';
import {createAndPayBidBatchWallet} from '../src/modules/auctions/batch';
import {closeAuctionInTransaction} from '../src/modules/auctions/settlement';
import {publishSettledResult} from '../src/modules/auctions/result-publication';
import {processAuctionRefund} from '../src/modules/wallet/auction-refunds';
import {RULE_V5} from '../src/modules/auctions/rules';
const target=new URL(process.env.TEST_DATABASE_URL??'');
if(process.env.APP_ENV!=='local'||!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test')||process.env.PAYMENTS_LIVE_ENABLED!=='false')throw Error('Explicit disposable loopback test database with live payments off required');
const db=new PrismaClient({datasourceUrl:target.href,log:[{emit:'event',level:'query'}]}),samples:Array<{bids:number;participants:number;deadlineToDecisionMs:number;decisionTransactionMs:number;publicationMs:number;decisionToFirstRefundMs:number;decisionToAllRefundsMs:number}>=[];
let phase='setup';const slowQueries:Array<{phase:string;ms:number;sqlPrefix:string}>=[];
db.$on('query',event=>{if(event.duration>=250)slowQueries.push({phase,ms:event.duration,sqlPrefix:event.query.slice(0,180)})});
const clock=async()=>Number((await db.$queryRaw<Array<{ms:string}>>`SELECT (extract(epoch FROM clock_timestamp())*1000)::text AS ms`)[0].ms);
const p=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)];
try{
 await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:false,discountPercent:10,expiryDays:30},update:{enabled:false}});
 for(const size of [10,100,1000])for(let sample=0;sample<3;sample++){
  const a=await bidAuction(db,{ruleVersion:RULE_V5,fee:1,endDelayMs:size===1000?75000:12000,isDemo:false});await db.product.update({where:{id:a.productId!},data:{isDemo:false}});
  const users:string[]=Array.from({length:Math.max(2,Math.ceil(size/100))},()=>randomUUID());let remaining=size;
  for(let index=0;index<users.length;index++){
   const user=(await verifiedReferralUser(db,'Synthetic V5 timing fixture')).id;users[index]=user;await creditDevelopmentPoints(db,user,'1000','v5-benchmark:'+randomUUID());
   const count=index===users.length-1?remaining:Math.min(100,Math.ceil(size/users.length)),numbers=Array.from({length:count},(_,i)=>(1+i*0.1).toFixed(2));remaining-=count;
   const result=await createAndPayBidBatchWallet(db,user,{key:randomUUID(),auctionSlug:a.slug!,numbers,feeVersion:1,approvedTotal:count.toFixed(2)});if(result.kind!=='receipt')throw Error('Benchmark fixture did not pay');
  }
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,a.endsAt!.getTime()-Date.now()+5)));
  phase='decision';const decisionStarted=performance.now(),s=await db.$transaction(tx=>closeAuctionInTransaction(tx,a.id),{maxWait:15000,timeout:120000}),decisionCommit=await clock(),decisionTransactionMs=performance.now()-decisionStarted;if(s.outcome!=='CANCELLED'||s.decision!=='NO_UNIQUE_BID')throw Error('Repeated benchmark numbers must cancel');
  phase='publication';const publicationStart=performance.now();await publishSettledResult(db,a.id);const publicationMs=performance.now()-publicationStart;
  phase='refund';
  let first=0;for(let i=0;i<users.length;i++){if((await processAuctionRefund(db,a.id)).status!=='refunded')throw Error('Missing refund');if(!i)first=await clock()}
  const end=await clock();if((await processAuctionRefund(db,a.id)).status!=='idle')throw Error('Duplicate refund effect');
  if(await db.auctionRefund.count({where:{settlementId:s.id,status:'COMPLETED'}})!==users.length)throw Error('Incomplete benchmark refunds');
  samples.push({bids:size,participants:users.length,deadlineToDecisionMs:decisionCommit-a.endsAt!.getTime(),decisionTransactionMs,publicationMs,decisionToFirstRefundMs:first-decisionCommit,decisionToAllRefundsMs:end-decisionCommit});phase='setup';
  console.log(JSON.stringify(samples.at(-1)));
 }
 if((await reconcile(db)).length)throw Error('Benchmark reconciliation drift');
 const report={at:new Date().toISOString(),scope:'Isolated PostgreSQL; synthetic authenticated batch purchases; fee 1ETB; two or ten recipients; serial one-wallet refund transactions; no HTTP or production latency claim',samples,slowQueries,summary:[10,100,1000].map(size=>{const rows=samples.filter(r=>r.bids===size);return{bids:size,n:rows.length,deadlineToDecision:{p50:p(rows.map(r=>r.deadlineToDecisionMs),.5),p95:p(rows.map(r=>r.deadlineToDecisionMs),.95)},decisionToAllRefunds:{p50:p(rows.map(r=>r.decisionToAllRefundsMs),.5),p95:p(rows.map(r=>r.decisionToAllRefundsMs),.95)}}}),limitations:'Fresh fixture database warmed by purchases; shared local server and loopback latency; three samples per size. Provider, Telegram and commit-to-UI excluded; n=3 is not a production p95 estimate. Baseline report includes an earlier59-second end-to-end outlier and is retained separately; stage separation is explicit here.'};
 writeFileSync('docs/payments/evidence/unique-refund-timings-2026-11-17.json',JSON.stringify(report,null,2)+'\n');
}finally{await db.$disconnect();await(await import('../src/lib/db')).db.$disconnect()}
