import 'dotenv/config';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {seedCatalog} from './seed-catalog';
import {demoBidAllowed,submitBid} from '../src/modules/auctions/bids';
import {stagingDemoEnabled,stagingDemoUser} from '../src/modules/auctions/staging-demo';
import {creditDemoPoints,reconcile} from '../src/modules/wallet/ledger';
import {closeAuction,cancelAuction} from '../src/modules/auctions/settlement';
import {favoriteState} from '../src/modules/profile/personal';
const uuid=(s:string)=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
export async function seedShowcase(db:PrismaClient,batch:string,testerId?:string){
 if(!/^[a-z0-9-]{1,32}$/.test(batch)||!(demoBidAllowed()||stagingDemoEnabled()))throw Error('Isolated or pinned staging fixture capability required');
 if(testerId&&stagingDemoEnabled()&&!stagingDemoUser(testerId))throw Error('Explicit bounded tester allowlist required');
 const marker=`demo-showcase:${batch}`;const done=await db.adminAudit.findUnique({where:{id:uuid(`${marker}:complete`)}});const prior=await db.adminAudit.findUnique({where:{id:uuid(`${marker}:start`)}});
 if(done)return {replayed:true,...done.details as object};
 await seedCatalog(db,new Date(),stagingDemoEnabled()?180000:30000);
 const users=[testerId??`demo-showcase-${batch}-0`,`demo-showcase-${batch}-1`,`demo-showcase-${batch}-2`];
 for(const [i,id] of users.entries()){
  if(id!==testerId)await db.user.upsert({where:{id},create:{id,name:`DEMO showcase player ${i+1}`},update:{}});
  await creditDemoPoints(db,id,'1000',`${marker}:grant:${i}`);
  await db.notificationPreference.upsert({where:{userId:id},create:{userId:id,inApp:true,telegram:false},update:{}});
 }
 const anchor=prior?(prior.details as {anchor:string}).anchor:new Date().toISOString();
 await db.adminAudit.upsert({where:{id:uuid(`${marker}:start`)},create:{id:uuid(`${marker}:start`),actorId:'demo-showcase-operator',action:'DEMO_SHOWCASE_STARTED',target:marker,details:{anchor}},update:{}});
 const cases=[['rule','Lowest unique chair','home-furniture','chair'],['one','One-bid field watch','watches','watch'],['duplicate','Shared-choice headphones','accessories','accessory'],['zero','Quiet auction lamp','home-furnishings','furnishing'],['cancel','Cancelled phone example','phones','phone'],['active','Everyday notebook computer','computer-office-equipment','notebook']] as const;
 const ending=new Date(new Date(anchor).getTime()+(stagingDemoEnabled()?600000:20000));
 const auctions=[];
 for(const [kind,title,categorySlug,art] of cases){
  const slug=`demo-${batch}-${kind}`,category=await db.category.findUniqueOrThrow({where:{slug:categorySlug}});
  const product=await db.product.upsert({where:{slug},update:{},create:{slug,title:`DEMO ${title}`,description:'Labeled staging showcase. No real item, delivery or monetary deposit.',condition:'DEMO · Original illustration',isDemo:true,categoryId:category.id,images:{create:{path:`/catalog/${art}.svg`,alt:`Original ${title} illustration`,sourceType:'ORIGINAL'}}}});
  const auction=await db.auction.upsert({where:{code:`DEMO-${batch.toUpperCase()}-${kind.toUpperCase()}`},update:{},create:{code:`DEMO-${batch.toUpperCase()}-${kind.toUpperCase()}`,slug,productId:product.id,categoryId:category.id,status:'LIVE',startsAt:new Date(new Date(anchor).getTime()-60000),endsAt:kind==='active'?new Date(new Date(anchor).getTime()+12*3600000):ending,publishedAt:new Date(anchor),isDemo:true,isSettlementFixture:true,featured:kind==='active',fulfillmentSummary:'DEMO only. Fulfillment pending; no physical item will ship.',fulfillmentRegion:'DEMO · No delivery',terms:{create:{minPoints:'1',maxPoints:'100',stepPoints:'1',entryFeePoints:'2',maxDistinctBids:100,noWinnerTerms:'No unique amount: all holds released, disclosed fees retained.',cancellationTerms:'All holds and entry fees refunded on cancellation.',fulfillmentSnapshot:'DEMO only. Nothing will ship.'}}}});
  await db.auctionFeeRevision.upsert({where:{auctionId_version:{auctionId:auction.id,version:1}},update:{},create:{auctionId:auction.id,version:1,feePoints:'2',effectiveAt:new Date(anchor),reason:'DEMO showcase initial fee'}});
  auctions.push(auction);
 }
 const patterns=[[ [0,2],[0,4],[1,1],[2,1],[1,3],[2,3] ],[[0,7]],[[0,9],[1,9]],[],[[0,11]],[[0,5],[1,6]]];
 for(const [i,auction] of auctions.entries())for(const [n,[who,amount]] of patterns[i].entries())await submitBid(db,{userId:users[who],auctionSlug:auction.slug!,amount:String(amount),key:uuid(`${marker}:bid:${i}:${n}`)});
 await favoriteState(db,users[0],auctions[5].slug!,true);
 await cancelAuction(db,{auctionId:auctions[4].id,actor:{id:'demo-showcase-operator',permission:'auction:cancel'},reason:'DEMO cancellation with exact entry-fee refunds.',key:uuid(`${marker}:cancel`)});
 // Explicit safe fixtures only: no provider evidence, claim or credited journal.
 for(const status of ['PENDING','NEEDS_REVIEW','REJECTED'])await db.topUpIntent.upsert({where:{userId_key:{userId:users[0],key:`${marker}:funding:${status}`}},update:{},create:{userId:users[0],key:`${marker}:funding:${status}`,provider:'DEMO_PREVIEW',status,points:'100',policyVersion:'DEMO-NOT-A-PAYMENT',reasonCode:'DEMO_ONLY_NO_TRANSFER',quoteSnapshot:{demo:true,label:'DEMO funding preview. No money transferred or points credited.'}}});
 await db.siteContent.upsert({where:{id:'home'},update:{},create:{id:'home',body:{headline:'A little different wins.',lead:'The lowest point amount chosen only once wins. Explore the DEMO showcase and learn the rules.'}}});
 console.log(JSON.stringify({batch,stage:'bids-accepted',waitingForPublishedDeadline:ending.toISOString()}));
 while(Date.now()<=ending.getTime()+250)await new Promise(r=>setTimeout(r,Math.min(15000,ending.getTime()+300-Date.now())));
 for(const auction of auctions.slice(0,4))await closeAuction(db,auction.id);
 for(const result of await db.auctionSettlement.findMany({where:{auctionId:{in:auctions.map(a=>a.id)},outcome:'WINNER'}}))await db.fulfillmentCase.upsert({where:{auctionId:result.auctionId},update:{},create:{auctionId:result.auctionId,userId:result.winnerUserId!,state:'PENDING',note:'DEMO sample. No item will be shipped.'}});
 const drift=await reconcile(db);if(drift.length)throw Error('Showcase reconciliation failed');
 const counts={categories:await db.category.count(),products:await db.product.count(),auctions:await db.auction.count(),bids:await db.bid.count(),wallets:await db.wallet.count(),journals:await db.journal.count(),settlements:await db.auctionSettlement.count(),illustrativeResults:await db.publicAuctionResult.count(),fundingPreviews:await db.topUpIntent.count({where:{provider:'DEMO_PREVIEW'}}),alerts:await db.notificationInbox.count(),reconciliationDrift:0};
 await db.adminAudit.create({data:{id:uuid(`${marker}:complete`),actorId:'demo-showcase-operator',action:'DEMO_SHOWCASE_COMPLETED',target:marker,details:{anchor,counts}}});
 return {replayed:false,batch,counts};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/seed-showcase.ts')){
 const batch=process.argv[process.argv.indexOf('--batch')+1];if(!process.argv.includes('--batch'))throw Error('Explicit --batch required');
 const db=new PrismaClient({datasourceUrl:stagingDemoEnabled()?process.env.DIRECT_URL:process.env.DATABASE_URL,transactionOptions:{timeout:120000,maxWait:15000}});try{console.log(JSON.stringify(await seedShowcase(db,batch)))}finally{await db.$disconnect()}
}
