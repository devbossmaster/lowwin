import nextEnv from '@next/env';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
nextEnv.loadEnvConfig(process.cwd(),true);

const {stagingDemoEnabled}=await import('../src/modules/auctions/staging-demo');
const {demoCategories}=await import('./seed-catalog');
const {creditDemoPoints,reconcile}=await import('../src/modules/wallet/ledger');
const {submitBid}=await import('../src/modules/auctions/bids');
const {closeAuctionInTransaction,cancelAuction}=await import('../src/modules/auctions/settlement');
const {RULE_V4,V2_FALLBACK_TERMS,V4_CANCELLATION_TERMS}=await import('../src/modules/auctions/rules');
const {contactBotId}=await import('../src/modules/auth/own-contact');
const arg=(name:string)=>process.argv[process.argv.indexOf(name)+1];
const batch=arg('--batch'),project=arg('--project'),apply=process.argv.includes('--apply');
if(!process.argv.includes('--batch')||!/^[a-z0-9-]{1,24}$/.test(batch)||project!=='kgwjolbhtvfwuohrtjya'||!stagingDemoEnabled())throw Error('Explicit pinned staging project and preview batch required');
if(process.env.PAYMENTS_LIVE_ENABLED==='true'||process.env.ARIFPAY_ENABLED==='true')throw Error('Real payment providers must remain disabled');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=(value:string)=>{const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const marker=`demo-showcase:${batch}`,runId=uuid(marker),db=new PrismaClient({datasourceUrl:process.env.DIRECT_URL,transactionOptions:{maxWait:15000,timeout:120000}});
const identitySelect={id:true,name:true,email:true,emailVerified:true,telegramId:true,telegramUsername:true,image:true} as const;
const log=(stage:string,data:Record<string,unknown>={})=>console.log(JSON.stringify({stage,batch,...data}));
try{
 const completed=await db.adminAudit.findUnique({where:{id:uuid(marker+':complete')}});
 if(completed){log('already-seeded',{summary:completed.details});process.exitCode=0}
 else {
  const registered=await db.user.findMany({where:{id:{not:{startsWith:'demo-showcase-'}}},select:identitySelect,orderBy:{id:'asc'}});
  const testers=await db.user.findMany({where:{staffMember:{is:null},ownContact:{is:{botId:contactBotId(),revokedAt:null}}},select:{id:true},orderBy:{createdAt:'asc'},take:4});
  if(!testers.length||testers.length>3)throw Error('One to three verified staging testers required; review larger audiences explicitly');
  const allowed=[...new Set([...(process.env.STAGING_DEMO_USER_IDS??'').split(',').filter(Boolean),...testers.map(t=>t.id)])];
  if(allowed.length>20)throw Error('Staging tester allowlist exceeds limit');
  log('plan',{project,registeredCustomers:registered.length,testers:testers.length,live:12,upcoming:3,richResultAmounts:23,richResultParticipants:21,syntheticPlayers:21,apply});
  if(apply){
   if((await reconcile(db)).length)throw Error('Existing ledger discrepancy: seed refused');
   process.env.STAGING_DEMO_USER_IDS=allowed.join(',');
   await db.adminAudit.upsert({where:{id:uuid(marker+':start')},update:{},create:{id:uuid(marker+':start'),actorId:'demo-showcase-operator',action:'UI_PREVIEW_STARTED',target:marker,details:{project,registeredCount:registered.length,identityHash:hash(JSON.stringify(registered))}}});
   await db.testRun.upsert({where:{id:runId},update:{},create:{id:runId,label:`DEMO UI preview ${batch} — no prizes or real payments`,actorId:'demo-showcase-operator',state:'RUNNING'}});
   const categories=new Map<string,string>();
   const categoryAm:Record<string,string>={'home-furniture':'የቤት ዕቃዎች',vehicles:'ተሽከርካሪዎች',accessories:'መለዋወጫዎች','computer-office-equipment':'ኮምፒውተር እና የቢሮ ዕቃዎች','home-furnishings':'የቤት ማስዋቢያዎች',jewelry:'ጌጣጌጥ',watches:'ሰዓቶች',phones:'ስልኮች',animals:'እንስሳት'};
   for(const [index,[slug,name,description]] of demoCategories.entries()){const c=await db.category.upsert({where:{slug},update:{},create:{slug,name,nameAm:categoryAm[slug],description,sortOrder:index,requiresEligibilityReview:slug==='animals'}});categories.set(slug,c.id)}
   const players=Array.from({length:21},(_,i)=>`demo-showcase-${hash(marker).slice(0,8)}-${i}`);
   for(const [index,id] of players.entries()){
    await db.user.upsert({where:{id},update:{},create:{id,name:`DEMO anonymous player ${index+1}`}});
    await db.testRunActor.upsert({where:{testRunId_userId:{testRunId:runId,userId:id}},update:{},create:{testRunId:runId,userId:id,label:'Synthetic UI-only participant; no Telegram identity'}});
    await creditDemoPoints(db,id,'1000',`${marker}:player:${index}`);
   }
   for(const tester of testers)await creditDemoPoints(db,tester.id,'1000',`${marker}:tester`);
   log('players-ready');
   const items=[['Oak reading chair','የንባብ ወንበር','home-furniture','chair'],['Studio headphones','የስቱዲዮ ማዳመጫ','accessories','accessory'],['Compact workstation','ኮምፒውተር','computer-office-equipment','computer'],['Everyday smartphone','ዘመናዊ ስልክ','phones','phone'],['Field watch','የእጅ ሰዓት','watches','watch'],['Woven table lamp','የጠረጴዛ መብራት','home-furnishings','furnishing'],['Silver pendant','የብር ጌጥ','jewelry','jewelry'],['City commuter car','የከተማ መኪና','vehicles','vehicle']] as const;
   async function auction(kind:string,index:number,fee:number,startsAt:Date,endsAt:Date,settleable=true){
    const [en,am,category,art]=items[index%items.length],slug=`demo-${batch}-${kind}`,existing=await db.auction.findUnique({where:{slug}});if(existing)return existing;
    const product=await db.product.create({data:{slug,title:`DEMO · ${en}`,titleAm:`ሙከራ · ${am}`,description:'DEMO UI preview only. No actual prize, delivery, payment or winner announcement.',condition:'DEMO · Original illustration',categoryId:categories.get(category)!,isDemo:true,testRunId:runId,images:{create:{path:`/catalog/${art}.svg`,alt:`DEMO ${en} illustration`,sourceType:'ORIGINAL'}}}});
    const a=await db.auction.create({data:{slug,code:slug.toUpperCase(),productId:product.id,categoryId:product.categoryId,status:'DRAFT',isDemo:true,isSettlementFixture:settleable,testRunId:runId,startsAt,endsAt,fulfillmentSummary:'DEMO only. No item will ship.',fulfillmentRegion:'DEMO · No delivery',terms:{create:{ruleVersion:RULE_V4,minParticipants:2,minPoints:'1',maxPoints:null,stepPoints:'0.01',entryFeePoints:String(fee),maxDistinctBids:100,noWinnerTerms:V2_FALLBACK_TERMS,cancellationTerms:V4_CANCELLATION_TERMS,fulfillmentSnapshot:'DEMO only. No prize or money.',publishedEndsAt:endsAt}}}});
    await db.auctionFeeRevision.create({data:{auctionId:a.id,version:1,feePoints:String(fee),effectiveAt:new Date(Date.now()-60000),reason:'DEMO preview initial submission fee'}});
    return db.auction.update({where:{id:a.id},data:{publishedAt:new Date(),status:startsAt.getTime()>Date.now()?'SCHEDULED':'LIVE'}});
   }
   const now=Date.now(),live:Awaited<ReturnType<typeof auction>>[]=[];for(let i=0;i<12;i++)live.push(await auction(`live-${i+1}`,i,[5,10,15,25,40,60][i%6],new Date(now-60000),new Date(now+(i===0?20*60000:(24+i)*3600000))));
   for(let i=0;i<3;i++)await auction(`upcoming-${i+1}`,i+2,15+i*10,new Date(now+(24+i*8)*3600000),new Date(now+(72+i*8)*3600000));
   await auction('result-pending',4,10,new Date(now-60000),new Date(Date.now()+5000),false);
   const canceled=await auction('cancelled',3,5,new Date(now-60000),new Date(now+3600000));
   await cancelAuction(db,{auctionId:canceled.id,actor:{id:'demo-showcase-operator',permission:'auction:cancel'},reason:'DEMO UI cancellation. No real prize or payment.',key:uuid(marker+':cancel')});
   let maxBidMs=1000;
   const bid=async(userId:string,a:typeof live[number],amount:string,key:string)=>{const start=Date.now();const result=await submitBid(db,{userId,auctionSlug:a.slug!,amount,key:uuid(marker+':bid:'+key),feeVersion:1});maxBidMs=Math.max(maxBidMs,Date.now()-start);return result};
   for(const [i,t] of testers.entries()){
    await bid(t.id,live[0],String(10+i*2),`active:${i}`);
    await bid(t.id,live[1],String(30+i*2),`active-long:${i}`);
    await db.auctionFavorite.upsert({where:{userId_auctionId:{userId:t.id,auctionId:live[1].id}},update:{},create:{userId:t.id,auctionId:live[1].id}});
    for(const [kind,title,body,href] of [['PAYMENT_PENDING','DEMO · Payment pending','UI preview only. No transfer was made or credit issued.','/payments'],['PAYMENT_NEEDS_REVIEW','DEMO · Payment needs review','UI preview only. This is an example notification, not provider evidence.','/payments'],['AUCTION_CANCELLED','DEMO · Auction cancelled','UI preview only. No real item was offered.',`/auctions/${canceled.publicCode}`]])await db.notificationInbox.upsert({where:{key:`${marker}:notice:${i}:${kind}`},update:{},create:{key:`${marker}:notice:${i}:${kind}`,userId:t.id,kind,title,body,href,testRunId:runId}});
   }
   log('catalog-ready',{live:12,upcoming:3});
   const richWindow=Math.max(90000,Math.min(900000,maxBidMs*70));
   const rich=await auction('rich-result',1,1,new Date(Date.now()-60000),new Date(Date.now()+richWindow));
   log('result-submissions-starting',{maxObservedBidMs:maxBidMs,publishedWindowSeconds:Math.ceil(richWindow/1000)});
   const participants=[...testers.map(t=>t.id),...players].slice(0,21);
   for(const [i,id] of participants.entries()){await bid(id,rich,'50',`rich-repeat:${i}`);if(i%5===0)log('result-bids',{submitted:i+1,total:43})}
   for(let i=1;i<=22;i++){await bid(i===1?testers[0].id:players[0],rich,String(i*2),`rich-distinct:${i}`);if(i%5===0)log('result-bids',{submitted:21+i,total:43})}
   const finals=[rich];
   for(const [i,t] of testers.entries()){
    const a=await auction(`personal-win-${i+1}`,i+3,2,new Date(Date.now()-60000),new Date(Date.now()+Math.max(180000,maxBidMs*8)));
    await bid(t.id,a,'3',`win:${i}:owner`);await bid(players[1],a,'20',`win:${i}:other`);finals.push(a);
   }
   const deadline=Math.max(...finals.map(a=>a.endsAt!.getTime()));
   while(Date.now()<=deadline+100){log('waiting-for-published-deadline',{seconds:Math.ceil((deadline-Date.now())/1000)});await new Promise(resolve=>setTimeout(resolve,Math.min(30000,Math.max(100,deadline-Date.now()+150))))}
   // Reopen the operator connection after the published wait. Poolers may expire
   // an idle session; replaying this server command cannot settle twice.
   for(const a of finals){
    let result:Awaited<ReturnType<typeof closeAuctionInTransaction>>|undefined;
    for(let attempt=0;attempt<3;attempt++){
     try{await db.$disconnect();result=await db.$transaction(tx=>closeAuctionInTransaction(tx,a.id),{isolationLevel:'ReadCommitted',maxWait:20000,timeout:240000});break}
     catch(error){if(!['P1001','P1017','P2028'].includes((error as {code?:string}).code??'')||attempt===2)throw error;log('retrying-preview-settlement',{attempt:attempt+1});await new Promise(r=>setTimeout(r,500))}
    }
    if(result?.outcome!=='WINNER')throw Error('Expected demo winner settlement');await db.fulfillmentCase.upsert({where:{auctionId:a.id},update:{},create:{auctionId:a.id,userId:result.winnerUserId!,state:'PENDING',note:'DEMO UI-only fulfillment. Nothing will ship.',testRunId:runId}})
   }
   if((await reconcile(db)).length)throw Error('Preview ledger reconciliation failed');
   const after=await db.user.findMany({where:{id:{in:registered.map(u=>u.id)}},select:identitySelect,orderBy:{id:'asc'}});
   if(hash(JSON.stringify(after))!==hash(JSON.stringify(registered)))throw Error('Registered customer identity changed');
   const counts={live:12,upcoming:3,finalWinners:finals.length,canceled:1,pending:1,syntheticPlayers:21,registeredCustomersPreserved:registered.length,privateTesters:testers.length,amounts:23,participants:21,reconciliationDrift:0};
   await db.adminAudit.create({data:{id:uuid(marker+':complete'),actorId:'demo-showcase-operator',action:'UI_PREVIEW_COMPLETED',target:marker,details:{project,runId,...counts}}});log('complete',counts);
  }
 }
}catch(error){const e=error as {code?:string;name?:string;message?:string};console.error(JSON.stringify({stage:'failed',code:e.code??e.name,reason:/^[A-Z_]+$/.test(e.message??'')?e.message:undefined}));process.exitCode=1}finally{await db.$disconnect()}
