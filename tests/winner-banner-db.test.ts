import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction} from '../src/modules/auctions/settlement';
import {saveWinnerBanner} from '../src/modules/admin/winner-banner';
import {saveWinnerPhoto} from '../src/modules/admin/winner-photo';
import {publishFixtureResult} from './publish-result-fixture';
const url=process.env.WINNER_BANNER_TEST_DATABASE_URL;
describe.skipIf(!url)('Winners banner isolated PostgreSQL invariants',()=>{
 let db:PrismaClient,auctionId:string,operator:string,banner:string,second:string,photo:string;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback _test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient({datasourceUrl:url});operator=randomUUID();await db.user.create({data:{id:operator,name:'Isolated banner operator',role:'admin',emailVerified:true}});
  const png=await sharp({create:{width:1840,height:800,channels:3,background:'#c4a127'}}).png().toBuffer(),webp=await sharp(png).webp().toBuffer();
  photo=(await db.managedMedia.create({data:{bytes:Uint8Array.from(png),mime:'image/png',purpose:'WINNER_PHOTO',sourceType:'SUPPLIED',sourceCredit:'Isolated banner fixture'}})).id;
  for(let n=0;n<2;n++){const m=await db.managedMedia.create({data:{bytes:Uint8Array.from(webp),mime:'image/webp',purpose:'WINNER_BANNER',sourceType:'SUPPLIED',sourceCredit:'Isolated banner fixture'}});if(n)second=m.id;else banner=m.id}
  const auction=await bidAuction(db,{isDemo:false,fee:0,endDelayMs:2200});auctionId=auction.id;
  const first=await bidUser(db,'100'),other=await bidUser(db,'100');
  await submitBid(db,{userId:first,auctionSlug:auction.slug!,amount:'1',feeVersion:1,key:randomUUID()});await submitBid(db,{userId:other,auctionSlug:auction.slug!,amount:'2',feeVersion:1,key:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+50)));await closeAuction(db,auctionId);await publishFixtureResult(db,auctionId);
 },60000);
 afterAll(async()=>{await db?.$disconnect();await (await import('../src/lib/db')).db.$disconnect()});
 const save=(version:number,imageId:string|null)=>db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;return saveWinnerBanner(tx,{id:operator,role:'OWNER',now:new Date()},{key:randomUUID(),auctionId,version,imageId,consentConfirmed:true,reason:'Isolated consented complete Winners banner'})});
 const immutable=async()=>JSON.stringify({auction:await db.auction.findUnique({where:{id:auctionId}}),product:await db.product.findMany({orderBy:{id:'asc'}}),settlement:await db.auctionSettlement.findUnique({where:{auctionId}}),publication:await db.resultPublication.findFirst({where:{settlement:{auctionId}}}),journals:await db.journal.findMany({orderBy:{id:'asc'}}),outbox:await db.outbox.findMany({orderBy:{id:'asc'}})},(_,v)=>typeof v==='bigint'?v.toString():v);
 it('adds/replaces/removes only the banner and retains the historical photo and all canonical facts',async()=>{
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auctionId} FOR UPDATE`;await saveWinnerPhoto(tx,{id:operator,role:'OWNER',now:new Date()},{key:randomUUID(),auctionId,version:0,imageId:photo,consentConfirmed:true,reason:'Historical consented photograph fixture'})});
  const before=await immutable();expect(await save(1,banner)).toMatchObject({presentationMode:'BANNER',version:2});expect(await save(2,second)).toMatchObject({presentationMode:'BANNER',version:3});expect(await save(3,null)).toMatchObject({presentationMode:'PRODUCT',version:4});
  const row=await db.winnerPresentation.findUniqueOrThrow({where:{auctionId}});expect(row.imageId).toBe(photo);expect(row.consentActorId).toBe(operator);expect(row.bannerImageId).toBeNull();expect(await immutable()).toBe(before);
 });
 it('serializes concurrent replacement attempts and rejects stale versions',async()=>{
  const version=(await db.winnerPresentation.findUniqueOrThrow({where:{auctionId}})).version,results=await Promise.allSettled([save(version,banner),save(version,second)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
 it('enforces media-purpose, consent, catalog separation and immutable cutover in PostgreSQL',async()=>{
  const row=await db.winnerPresentation.findUniqueOrThrow({where:{auctionId}}),auction=await db.auction.findUniqueOrThrow({where:{id:auctionId}});
  await expect(db.winnerPresentation.update({where:{auctionId},data:{bannerConsentActorId:null,version:{increment:1}}})).rejects.toThrow();
  await expect(db.winnerPresentation.update({where:{auctionId},data:{bannerImageId:photo,version:{increment:1}}})).rejects.toThrow();
  await expect(db.winnerPresentation.update({where:{auctionId},data:{bannerImageId:second}})).rejects.toThrow();
  await expect(db.productImage.create({data:{productId:auction.productId!,path:`/api/media/${banner}`,alt:'Forbidden Winners-only media'}})).rejects.toThrow();
  await expect(db.auction.update({where:{id:auctionId},data:{presentation:{images:[{path:`/api/media/${banner}`}]}}})).rejects.toThrow();
  await expect(db.resultPublicationPolicy.update({where:{id:'auto'},data:{automaticFrom:new Date()}})).rejects.toThrow();
  expect(await db.winnerPresentation.findUnique({where:{auctionId}})).toEqual(row);expect((await db.resultPublicationPolicy.findUniqueOrThrow({where:{id:'auto'}})).automaticFrom).toBeInstanceOf(Date);
 });
});
