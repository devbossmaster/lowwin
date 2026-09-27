import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

export const demoCategories = [
  ['home-furniture', 'Home Furniture', 'Considered pieces for the rooms you live in.', 'chair'],
  ['vehicles', 'Vehicles', 'Illustrative vehicle listings and collection terms.', 'vehicle'],
  ['accessories', 'Accessories', 'Useful everyday details and personal pieces.', 'accessory'],
  ['computer-office-equipment', 'Computer & Office Equipment', 'Tools for work, study and creating.', 'computer'],
  ['home-furnishings', 'Home Furnishings', 'The finishing touches that make a space yours.', 'furnishing'],
  ['jewelry', 'Jewelry', 'Small statement pieces with clear condition notes.', 'jewelry'],
  ['watches', 'Watches', 'Timepieces and their individual details.', 'watch'],
  ['phones', 'Phones', 'Handsets with explicit condition and delivery notes.', 'phone'],
  ['animals', 'Animals', 'No live animal auctions. Eligibility and welfare review is required before any future listing.', 'animal'],
] as const;

type DemoItem = {
  slug: string; code: string; category: string; title: string; description: string;
  condition: string; art: string; status: 'LIVE' | 'SCHEDULED' | 'CLOSED';
  startHours: number; endHours: number; featured?: boolean; fee?: number;
  outcome?: 'WINNER' | 'NO_WINNER'; winningPoints?: number;
};
const items: DemoItem[] = [
  { slug:'oak-lounge-chair',code:'DEMO-FUR-001',category:'home-furniture',title:'Oak lounge chair',description:'A sculptural lounge chair with a natural oak frame and woven seat. Demonstration inventory only.',condition:'DEMO · New condition illustration',art:'chair',status:'LIVE',startHours:-8,endHours:18,featured:true,outcome:undefined },
  { slug:'city-commuter-car',code:'DEMO-VEH-001',category:'vehicles',title:'City commuter car',description:'A compact city vehicle shown as a catalog demonstration. No real vehicle is offered.',condition:'DEMO · Condition to be verified',art:'vehicle',status:'LIVE',startHours:-3,endHours:68,featured:true },
  { slug:'studio-headphones',code:'DEMO-ACC-001',category:'accessories',title:'Studio headphones',description:'Over-ear headphones illustrated for catalog layout. Demonstration inventory only.',condition:'DEMO · New condition illustration',art:'accessory',status:'LIVE',startHours:-12,endHours:9,featured:true },
  { slug:'compact-workstation',code:'DEMO-COM-001',category:'computer-office-equipment',title:'Compact workstation',description:'A compact desktop setup for a considered workspace. Demonstration inventory only.',condition:'DEMO · Condition to be verified',art:'computer',status:'LIVE',startHours:-20,endHours:36,featured:true },
  { slug:'woven-table-lamp',code:'DEMO-HFU-001',category:'home-furnishings',title:'Woven table lamp',description:'A softly lit table lamp with a woven shade. Demonstration inventory only.',condition:'DEMO · New condition illustration',art:'furnishing',status:'LIVE',startHours:-4,endHours:20 },
  { slug:'silver-pendant',code:'DEMO-JEW-001',category:'jewelry',title:'Silver pendant',description:'A minimal pendant illustrated for catalog demonstration. No real jewelry is offered.',condition:'DEMO · Condition to be verified',art:'jewelry',status:'LIVE',startHours:-6,endHours:72 },
  { slug:'classic-field-watch',code:'DEMO-WAT-001',category:'watches',title:'Classic field watch',description:'A simple field watch illustration. Demonstration inventory only.',condition:'DEMO · Condition to be verified',art:'watch',status:'LIVE',startHours:-2,endHours:14 },
  { slug:'everyday-smartphone',code:'DEMO-PHO-001',category:'phones',title:'Everyday smartphone',description:'An illustrated smartphone with a clear demonstration label. No real handset is offered.',condition:'DEMO · Condition to be verified',art:'phone',status:'LIVE',startHours:-5,endHours:45 },
  { slug:'reading-chair',code:'DEMO-FUR-002',category:'home-furniture',title:'Reading chair',description:'An upholstered chair for a quiet reading corner. Demonstration inventory only.',condition:'DEMO · New condition illustration',art:'chair',status:'SCHEDULED',startHours:30,endHours:102 },
  { slug:'minimal-desk-set',code:'DEMO-COM-002',category:'computer-office-equipment',title:'Minimal desk set',description:'An illustrated desk and equipment set. Demonstration inventory only.',condition:'DEMO · New condition illustration',art:'computer',status:'SCHEDULED',startHours:48,endHours:144 },
  { slug:'portrait-phone',code:'DEMO-PHO-002',category:'phones',title:'Portrait smartphone',description:'An illustrated handset shown for upcoming catalog layout.',condition:'DEMO · Condition to be verified',art:'phone',status:'SCHEDULED',startHours:24,endHours:96 },
  { slug:'archive-watch',code:'DEMO-WAT-002',category:'watches',title:'Archive watch',description:'An illustrative closed watch listing and result.',condition:'DEMO · Condition to be verified',art:'watch',status:'CLOSED',startHours:-120,endHours:-48,outcome:'WINNER',winningPoints:7 },
  { slug:'ceramic-vase',code:'DEMO-HFU-002',category:'home-furnishings',title:'Ceramic vase',description:'An illustrative closed home listing with no unique result.',condition:'DEMO · New condition illustration',art:'furnishing',status:'CLOSED',startHours:-96,endHours:-24,outcome:'NO_WINNER' },
  { slug:'everyday-tote',code:'DEMO-ACC-002',category:'accessories',title:'Everyday tote',description:'An illustrative closed accessory listing.',condition:'DEMO · New condition illustration',art:'accessory',status:'CLOSED',startHours:-72,endHours:-2,outcome:'WINNER',winningPoints:3 },
];

export async function seedCatalog(client: PrismaClient, now = new Date()) {
  await client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lowin:demo-catalog', 0))`;
    const categoryIds = new Map<string,string>();
    for (const [index, [slug, name, description]] of demoCategories.entries()) {
      const category = await tx.category.upsert({ where:{slug}, update:{}, create:{slug,name,description,sortOrder:index,requiresEligibilityReview:slug==='animals'} });
      categoryIds.set(slug,category.id);
    }
    for (const item of items) {
      const categoryId = categoryIds.get(item.category)!;
      const product = await tx.product.upsert({where:{slug:`demo-${item.slug}`},update:{},create:{slug:`demo-${item.slug}`,title:item.title,description:item.description,condition:item.condition,categoryId,isDemo:true}});
      await tx.productImage.upsert({where:{productId_sortOrder:{productId:product.id,sortOrder:0}},update:{},create:{productId:product.id,path:`/catalog/${item.art}.svg`,alt:`Original illustration of ${item.title}`,sourceType:'ORIGINAL',sortOrder:0}});
      const at = (hours:number) => new Date(now.getTime()+hours*60*60*1000);
      const auction = await tx.auction.upsert({where:{code:item.code},update:{},create:{code:item.code,slug:`demo-${item.slug}`,productId:product.id,categoryId,status:item.status,startsAt:at(item.startHours),endsAt:at(item.endHours),publishedAt:now,featured:item.featured??false,isDemo:true,fulfillmentSummary:'DEMO only. No item will be dispatched. Real listings must state delivery method and eligibility before opening.',fulfillmentRegion:'DEMO · No delivery area'}});
      await tx.auctionTerms.upsert({where:{auctionId:auction.id},update:{},create:{auctionId:auction.id,version:1,ruleVersion:'lowest-unique-v1',minPoints:1n,maxPoints:100n,stepPoints:1n,entryFeePoints:BigInt(item.fee??0),maxDistinctBids:100,noWinnerTerms:'If no point amount is unique, there is no winner and all holds are released.',cancellationTerms:'If Lowin cancels an auction, all holds and charged entry fees are returned.',fulfillmentSnapshot:'DEMO only. No item will be dispatched. Eligibility and delivery must be confirmed before a real auction opens.'}});
      if (item.outcome) await tx.publicAuctionResult.upsert({where:{auctionId:auction.id},update:{},create:{auctionId:auction.id,outcome:item.outcome,winningPoints:item.winningPoints?BigInt(item.winningPoints):null,winnerLabel:item.outcome==='WINNER'?'DEMO illustrative outcome':null,explanation:item.outcome==='WINNER'?`DEMO example: ${item.winningPoints} points is the lowest unique amount in an illustrative result. No real bids or winner are recorded.`:'DEMO example: no amount was unique. No real bids or winner are recorded.',closedAt:at(item.endHours),isDemo:true,publishedAt:now}});
    }
  },{timeout:30000});
  return {categories:demoCategories.length,auctions:items.length};
}

if (process.argv[1]?.replaceAll('\\','/').endsWith('/seed-catalog.ts')) {
  const url = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '');
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Demo seed requires a loopback disposable *_test database');
  const client = new PrismaClient();
  seedCatalog(client).then(result => console.log(`DEMO catalog ready: ${result.categories} categories, ${result.auctions} auctions`)).finally(()=>client.$disconnect());
}
