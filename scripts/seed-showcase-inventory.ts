import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {demoCategories} from './seed-catalog';
import {demoBidAllowed} from '../src/modules/auctions/bids';
import {stagingDemoEnabled} from '../src/modules/auctions/staging-demo';
const batch=process.argv[process.argv.indexOf('--batch')+1];
if(!process.argv.includes('--batch')||!/^[a-z0-9-]{1,32}$/.test(batch)||!(demoBidAllowed()||stagingDemoEnabled()))throw Error('Explicit fixture batch required');
const db=new PrismaClient({datasourceUrl:stagingDemoEnabled()?process.env.DIRECT_URL:process.env.DATABASE_URL,transactionOptions:{timeout:120000}});
try{
 const target=`demo-inventory:${batch}`,id=createHash('sha256').update(target).digest('hex'),done=await db.adminAudit.findUnique({where:{id:id+':done'}});
 if(done){console.log(JSON.stringify({replayed:true,batch}));process.exitCode=0}else{
  const previous=await db.adminAudit.findUnique({where:{id}}),anchor=previous?(previous.details as {anchor:string}).anchor:new Date().toISOString();
  await db.adminAudit.upsert({where:{id},update:{},create:{id,actorId:'demo-showcase-operator',action:'DEMO_INVENTORY_STARTED',target,details:{anchor}}});
  for(const [i,[categorySlug,name,,art]] of demoCategories.entries()){
   if(categorySlug==='animals')continue;
   const category=await db.category.findUniqueOrThrow({where:{slug:categorySlug}});
   for(const mode of ['live','upcoming']){
    const slug=`demo-${batch}-${art}-${mode}`;const title=({chair:'Oak reading chair',vehicle:'City commuter',accessory:'Studio headphones',computer:'Compact workstation',furnishing:'Woven table lamp',jewelry:'Silver pendant',watch:'Field watch',phone:'Everyday smartphone'} as Record<string,string>)[art];
    const product=await db.product.upsert({where:{slug},update:{},create:{slug,title:`DEMO ${title}`,description:`DEMO ${name} showcase. No real item or delivery.`,condition:'DEMO · Original illustration',categoryId:category.id,isDemo:true,images:{create:{path:`/catalog/${art}.svg`,alt:`Original ${title} illustration`,sourceType:'ORIGINAL'}}}});
    const time=(h:number)=>new Date(new Date(anchor).getTime()+h*3600000);
    const auction=await db.auction.upsert({where:{code:slug.toUpperCase()},update:{},create:{code:slug.toUpperCase(),slug,productId:product.id,categoryId:category.id,isDemo:true,isSettlementFixture:true,status:mode==='live'?'LIVE':'SCHEDULED',publishedAt:new Date(anchor),startsAt:time(mode==='live'?-1:24+i*6),endsAt:time(mode==='live'?6+i*2:72+i*6),featured:mode==='live'&&i<4,fulfillmentSummary:'DEMO only. No real item will ship.',fulfillmentRegion:'DEMO',terms:{create:{minPoints:'1',maxPoints:'100',stepPoints:'1',entryFeePoints:String(i%3),maxDistinctBids:100,noWinnerTerms:'All holds released; disclosed entry fees retained.',cancellationTerms:'All holds and entry fees returned.',fulfillmentSnapshot:'DEMO only. Nothing will ship.'}}}});
    await db.auctionFeeRevision.upsert({where:{auctionId_version:{auctionId:auction.id,version:1}},update:{},create:{auctionId:auction.id,version:1,feePoints:String(i%3),effectiveAt:new Date(anchor),reason:'DEMO inventory initial fee'}});
   }
  }
  await db.adminAudit.create({data:{id:id+':done',actorId:'demo-showcase-operator',action:'DEMO_INVENTORY_COMPLETED',target,details:{anchor,live:8,upcoming:8}}});console.log(JSON.stringify({replayed:false,batch,live:8,upcoming:8,animalsLive:0}));
 }
}finally{await db.$disconnect()}
