import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {publishFixtureResult} from './publish-result-fixture';
import {closeAuction} from '../src/modules/auctions/settlement';
import {reconcile} from '../src/modules/wallet/ledger';
import {saveWinnerPhoto} from '../src/modules/admin/winner-photo';
import {publicAuctionSelect,toPublicAuction} from '../src/modules/auctions/catalog';

const url=process.env.WINNER_PHOTO_TEST_DATABASE_URL??process.env.OPS_TEST_DATABASE_URL;
describe.skipIf(!url)('winner presentation on isolated PostgreSQL',()=>{
 let db:PrismaClient,auction:Awaited<ReturnType<typeof bidAuction>>,operator:string,image:string,second:string;
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Explicit disposable loopback database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});db=new PrismaClient({datasourceUrl:url});
  operator=randomUUID();await db.user.create({data:{id:operator,name:'Isolated winner media operator',role:'admin',emailVerified:true}});
  const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
  const media=()=>db.managedMedia.create({data:{bytes,mime:'image/png',sourceType:'SUPPLIED',sourceCredit:'Isolated consented fixture',purpose:'WINNER_PHOTO'}});
  image=(await media()).id;second=(await media()).id;
  auction=await bidAuction(db,{isDemo:false,fee:0,endDelayMs:1600});
  const first=await bidUser(db),other=await bidUser(db);
  await submitBid(db,{userId:first,auctionSlug:auction.slug!,amount:'1',key:randomUUID()});await submitBid(db,{userId:other,auctionSlug:auction.slug!,amount:'2',key:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+50)));expect((await closeAuction(db,auction.id)).outcome).toBe('WINNER');
 },60000);
 afterAll(async()=>{await db?.$disconnect();await (await import('../src/lib/db')).db.$disconnect()});
 const save=(version:number,imageId:string|null)=>db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Auction" WHERE id=${auction.id} FOR UPDATE`;
  return saveWinnerPhoto(tx,{id:operator,role:'OWNER',now:new Date()},{key:randomUUID(),auctionId:auction.id,version,imageId,consentConfirmed:true,reason:'Isolated authorized winner photo'});
 });
 const money=async()=>JSON.stringify({auction:await db.auction.findUnique({where:{id:auction.id}}),settlement:await db.auctionSettlement.findUnique({where:{auctionId:auction.id}}),bids:await db.bid.findMany({where:{auctionId:auction.id},orderBy:{id:'asc'}}),journals:await db.journal.findMany({orderBy:{id:'asc'}}),balances:await db.ledgerAccount.findMany({orderBy:{id:'asc'}})},(_,value)=>typeof value==='bigint'?value.toString():value);
 it('adds, replaces and resets the photo while all winning and ledger facts remain identical',async()=>{
  const before=await money();expect(await save(0,image)).toMatchObject({version:1,imageId:image});
  vi.doMock('../src/lib/db',()=>({db}));
  const media=await import('../src/app/api/media/[id]/route');
  const read=(id:string)=>media.GET(new Request(`https://lowwin.test/api/media/${id}`),{params:Promise.resolve({id})});
  expect((await read(image)).status).toBe(404);await publishFixtureResult(db,auction.id);
  const shown=await read(image);expect(shown.status).toBe(200);expect(shown.headers.get('cache-control')).toContain('no-store');expect((await shown.arrayBuffer()).byteLength).toBeGreaterThan(0);
  const row=await db.auction.findUniqueOrThrow({where:{id:auction.id},select:publicAuctionSelect});expect(toPublicAuction(row,new Date()).result?.winnerPhotoPath).toBe(`/api/media/${image}`);
  expect(await save(1,second)).toMatchObject({version:2,imageId:second});expect((await read(image)).status).toBe(404);expect((await read(second)).status).toBe(200);
  expect(await save(2,null)).toMatchObject({version:3,imageId:null,path:null});expect((await read(second)).status).toBe(404);
  expect(await money()).toBe(before);expect(await reconcile(db)).toEqual([]);
 });
 it('serializes concurrent editors and rejects stale versions instead of overwriting',async()=>{
  const expected=(await db.winnerPresentation.findUnique({where:{auctionId:auction.id}}))?.version??0;
  const result=await Promise.allSettled([save(expected,image),save(expected,second)]);expect(result.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(result.filter(value=>value.status==='rejected')).toHaveLength(1);
  expect((await db.winnerPresentation.findUniqueOrThrow({where:{auctionId:auction.id}})).version).toBe(expected+1);
 });
 it('keeps the table private and enforces consent/version/settled-winner guards in the database',async()=>{
  const [table]=await db.$queryRaw<{enabled:boolean}[]>`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='"WinnerPresentation"'::regclass`;expect(table.enabled).toBe(true);
  const before=await money();
  await expect(db.winnerPresentation.update({where:{auctionId:auction.id},data:{consentConfirmedAt:null,version:{increment:1}}})).rejects.toThrow();
  await expect(db.winnerPresentation.update({where:{auctionId:auction.id},data:{imageId:second}})).rejects.toThrow();
  await expect(db.winnerPresentation.delete({where:{auctionId:auction.id}})).rejects.toThrow();
  await expect(db.managedMedia.update({where:{id:image},data:{purpose:'CATALOG'}})).rejects.toThrow();
  await expect(db.productImage.create({data:{productId:auction.productId!,path:`/api/media/${image}`,alt:'Forbidden personal photo'}})).rejects.toThrow();
  await expect(db.auction.update({where:{id:auction.id},data:{presentation:{images:[{path:`/api/media/${image}`}]}}})).rejects.toThrow();
  const open=await bidAuction(db,{isDemo:false});await expect(db.winnerPresentation.create({data:{auctionId:open.id,imageId:image,consentActorId:operator,consentConfirmedAt:new Date()}})).rejects.toThrow();
  // Winning facts stay frozen; announcement editing is the separate allowed path.
  await expect(db.auctionSettlement.update({where:{auctionId:auction.id},data:{winningPoints:'0.01'}})).rejects.toThrow();
  expect(await money()).toBe(before);
 });
});
