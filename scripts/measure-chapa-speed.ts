/** Isolated service-path benchmark. Never contacts Chapa or a physical wallet. */
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';

const database=process.env.CHAPA_SPEED_TEST_DATABASE_URL??'';
const target=new URL(database);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
const mode=process.argv[2];
if(!['before','after'].includes(mode))throw Error('Usage: tsx scripts/measure-chapa-speed.ts before|after [report.json]');
Object.assign(process.env,{DATABASE_URL:database,DIRECT_URL:database,NODE_ENV:'test',APP_ENV:'local',CHAPA_MODE:'test',CHAPA_SCHEMA_READY:'true',CHAPA_PRIVATE_KEY:'CHAPA_TEST_'+'a'.repeat(40),CHAPA_WEBHOOK_SECRET:'a'.repeat(64),CHAPA_ENABLED:'true',CHAPA_RECOVERY_ENABLED:'true',PAYMENT_GATEWAY:'CHAPA',BETTER_AUTH_URL:'https://lowwin.test',MINI_APP_URL:'https://lowwin.test',DEV_POINTS_ENABLED:'false',DEV_IDENTITY_ENABLED:'false',STAGING_DEMO_ENABLED:'false',WALLET_BIDS_ENABLED:'true',PAYMENTS_LIVE_ENABLED:'false',ARIFPAY_ENABLED:'false',TELEGRAM_BOT_TOKEN:'123456789:chapa_speed_local_fixture_20261110',TELEGRAM_BOT_USERNAME:'lowin_speed_test_bot',TELEGRAM_WEBHOOK_SECRET:'local-chapa-speed-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'speed-test',PHONE_CONTACT_KEYS:JSON.stringify({'speed-test':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),REFERRAL_REWARDS_SCHEMA_READY:'true'});
execFileSync(process.execPath,[createRequire(import.meta.url).resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,stdio:'pipe'});
const db=new PrismaClient({datasourceUrl:database,log:[{emit:'event',level:'query'}]});
let queries=0,transactions=0,dispatchAt=0,queriesBeforeDispatch=0,transactionsBeforeDispatch=0,methodCalls=0;
db.$on('query',event=>{queries++;if(/^BEGIN\b/i.test(event.query))transactions++});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url==='https://api.chapa.global/v2/payments/methods'){
  methodCalls++;await delay(40);
  return Response.json({status:'success',data:[{name:'telebirr',slug:'telebirr',can_process_payments:true,can_process_direct_charge:true,supported_currencies:{ETB:{default_min:100,default_max:10000000,countries:{ET:{is_enabled:true,min_amount:100,max_amount:10000000}}}}}]});
 }
 if(url==='https://api.chapa.global/v2/payments/direct'){
  dispatchAt=performance.now();queriesBeforeDispatch=queries;transactionsBeforeDispatch=transactions;await delay(60);
  return Response.json({status:'success',data:{auth_type:'USSD',chapa_reference:'CH'+randomUUID().replaceAll('-',''),request_id:'speed-'+randomUUID(),payment_status:'PENDING',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString()}});
 }
 throw Error('Benchmark blocked unexpected network operation');
};
try{
 const {verifiedReferralUser,realReferralAuction}=await import('../tests/referral-fixtures');
 const {quoteBidBatch}=await import('../src/modules/auctions/batch');
 const direct=await import('../src/modules/payments/chapa-direct');
 const users=await Promise.all(Array.from({length:21},()=>verifiedReferralUser(db,'Isolated speed fixture')));
 const auction=await realReferralAuction(db,10);
 type SpeedSample={cache:string;preDispatchMs:number;totalMs:number;queriesBeforeDispatch:number;queriesTotal:number;transactionsBeforeDispatch:number;transactionsTotal:number;methodCalls:number};
 const samples:SpeedSample[]=[];
 for(let index=0;index<users.length;index++){
  const userId=users[index].id,key=randomUUID(),quoteKey=randomUUID();
  // One real read models the transactional authorization callback; HTTP/session
  // authentication is measured separately by route/browser checks, not here.
  const reauthorize=async(tx:Parameters<NonNullable<Parameters<typeof quoteBidBatch>[3]>>[0])=>{await tx.user.findUniqueOrThrow({where:{id:userId},select:{id:true}})};
  queries=transactions=dispatchAt=queriesBeforeDispatch=transactionsBeforeDispatch=0;
  const methodCount=methodCalls,start=performance.now();
  if(mode==='before'){
   const quote=await quoteBidBatch(db,userId,{key:quoteKey,auctionSlug:auction.slug,numbers:['2','3','4'],feeVersion:1},reauthorize);
   await direct.createDirectCheckout(db,userId,{key,purpose:'BID',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},reauthorize);
  }else{
   // The optimized command is installed by the focused application change.
   const command=(direct as unknown as {createBidDirectCheckout:(...args:unknown[])=>Promise<unknown>}).createBidDirectCheckout;
   if(!command)throw Error('Optimized direct bid command not available');
   await command(db,userId,{key,purpose:'BID',auctionSlug:auction.slug,numbers:['2','3','4'],feeVersion:1,approvedTotal:'30.00',paymentMethod:'telebirr',phone:'0911652904'},reauthorize);
  }
  const end=performance.now();
  if(!dispatchAt)throw Error('Expected exactly one mock direct dispatch');
  samples.push({cache:index?'warm':'cold',preDispatchMs:Math.round((dispatchAt-start)*100)/100,totalMs:Math.round((end-start)*100)/100,queriesBeforeDispatch,queriesTotal:queries,transactionsBeforeDispatch,transactionsTotal:transactions,methodCalls:methodCalls-methodCount});
 }
 const summarize=(rows:typeof samples)=>{
  const percentile=(field:keyof typeof samples[number],p:number)=>{const values=rows.map(row=>Number(row[field])).sort((a,b)=>a-b);return values[Math.max(0,Math.ceil(values.length*p)-1)]};
  return {samples:rows.length,preDispatchMs:{p50:percentile('preDispatchMs',.5),p95:percentile('preDispatchMs',.95)},totalMs:{p50:percentile('totalMs',.5),p95:percentile('totalMs',.95)},queryCountBeforeDispatch:{min:Math.min(...rows.map(row=>row.queriesBeforeDispatch)),max:Math.max(...rows.map(row=>row.queriesBeforeDispatch))},queriesTotal:{min:Math.min(...rows.map(row=>row.queriesTotal)),max:Math.max(...rows.map(row=>row.queriesTotal))},transactionsBeforeDispatch:{min:Math.min(...rows.map(row=>row.transactionsBeforeDispatch)),max:Math.max(...rows.map(row=>row.transactionsBeforeDispatch))},transactionsTotal:{min:Math.min(...rows.map(row=>row.transactionsTotal)),max:Math.max(...rows.map(row=>row.transactionsTotal))},methodCalls:rows.reduce((sum,row)=>sum+row.methodCalls,0)};
 };
 const report={mode,scope:'Real loopback PostgreSQL, simulated transactional authorization read, mocked provider: 40ms methods and 60ms direct response. Excludes HTTP/session/browser/physical USSD and remote infrastructure.',cold:samples[0],warm:summarize(samples.slice(1)),samples};
 const serialized=JSON.stringify(report,null,2);if(process.argv[3])writeFileSync(process.argv[3],serialized+'\n');console.log(serialized);
}finally{globalThis.fetch=originalFetch;await db.$disconnect();const shared=await import('../src/lib/db');await shared.db.$disconnect()}
