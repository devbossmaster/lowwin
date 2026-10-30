import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma,type PrismaClient} from '@prisma/client';
import {saveWinnerPhoto,winnerPhotoSchema} from '../src/modules/admin/winner-photo';
import {toPublicAuction} from '../src/modules/auctions/catalog';
import {opsMutation} from '../src/modules/admin/ops';
import {requireAdmin} from '../src/modules/admin/boundary';
import {clearPublicDataCache} from '../src/modules/cache/public-data';
import {AdminError} from '../src/modules/admin/errors';
import {adminMutation} from '../src/modules/admin/operations';
import {workspaceRead} from '../src/modules/admin/workspace';
import sharp from 'sharp';

const f=vi.hoisted(()=>({now:new Date('2026-10-30T01:00:00Z')}));
vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>({id:'staff',role:'OWNER',sessionId:'staff-session',now:f.now}))}));
vi.mock('../src/modules/cache/public-data',()=>({clearPublicDataCache:vi.fn(async()=>{}),cachedPublicData:(_key:string,_ttl:number,load:()=>unknown)=>load()}));
const auctionId='00000000-1111-4222-8333-444444444444',imageId='10000000-1111-4222-8333-444444444444',nextImage='20000000-1111-4222-8333-444444444444',key='30000000-1111-4222-8333-444444444444';
const actor=()=>({id:'staff',role:'OWNER' as const,now:f.now});
const input=(change:Record<string,unknown>={})=>winnerPhotoSchema.parse({key,auctionId,version:0,imageId,consentConfirmed:true,reason:'Winner authorized this published photograph',...change});
function fixture(change:Record<string,unknown>={}){
 let presentation:null|Record<string,unknown>=null,audit:null|Record<string,unknown>=null;
 const tx={
  $queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>0),
  auction:{findUnique:vi.fn(async()=>({status:'CLOSED',isDemo:false,testRunId:null,publishedAt:new Date('2026-10-29'),settlement:{publication:{publishedAt:new Date('2026-01-01')},outcome:'WINNER',winnerUserId:'winner',completedAt:new Date('2026-10-29T23:00:00Z')},...change}))},
  fulfillmentCase:{findUnique:vi.fn(async()=>({assignedTo:'staff'}))},
  managedMedia:{findUnique:vi.fn(async()=>({id:imageId,purpose:'WINNER_PHOTO'})),findFirst:vi.fn(async()=>null),findMany:vi.fn(async()=>[]),create:vi.fn(async({data}:{data:Record<string,unknown>})=>({id:imageId,...data}))},
  winnerPresentation:{findUnique:vi.fn(async()=>presentation),upsert:vi.fn(async({create,update}:{create:Record<string,unknown>;update:Record<string,unknown>})=>{presentation=presentation?{...presentation,...update,version:Number(presentation.version)+1}:{...create,version:1};return presentation})},
  adminAudit:{findFirst:vi.fn(async()=>null),findUnique:vi.fn(async()=>audit),create:vi.fn(async({data}:{data:Record<string,unknown>})=>{audit=data;return data})},
 };
 const client={$transaction:vi.fn(async(run:(tx:unknown)=>unknown)=>run(tx))} as unknown as PrismaClient;
 return {tx,client,db:tx as unknown as Prisma.TransactionClient};
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireAdmin).mockResolvedValue({...actor(),sessionId:'staff-session'} as Awaited<ReturnType<typeof requireAdmin>>)});

describe('editable, consented winner announcement media',()=>{
 it('publishes a validated photo separately from all result and money facts',async()=>{
  const {tx,db}=fixture(),result=await saveWinnerPhoto(db,actor(),input());
  expect(result).toEqual({auctionId,version:1,imageId,path:`/api/media/${imageId}`});
  expect(tx.winnerPresentation.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({consentConfirmedAt:f.now,consentActorId:'staff'})}));
  expect(Object.keys(tx)).not.toContain('auctionSettlement');expect(Object.keys(tx.auction)).toEqual(['findUnique']);expect(Object.keys(tx)).not.toContain('ledgerAccount');
 });
 it.each([
  {status:'LIVE'}, {isDemo:true}, {testRunId:'fixture-test-run'}, {publishedAt:null},
  {settlement:null},{settlement:{publication:{publishedAt:new Date('2026-01-01')},outcome:'NO_WINNER',winnerUserId:null,completedAt:new Date('2026-10-29')}},
  {settlement:{publication:{publishedAt:new Date('2026-01-01')},outcome:'WINNER',winnerUserId:'winner',completedAt:new Date('2026-11-01')}},
 ])('rejects an ineligible result without writing media: %j',async change=>{
  const {tx,db}=fixture(change);await expect(saveWinnerPhoto(db,actor(),input())).rejects.toMatchObject({status:409});expect(tx.winnerPresentation.upsert).not.toHaveBeenCalled();
 });
 it('requires explicit publication consent and an existing safely uploaded image',async()=>{
  const {tx,db}=fixture();await expect(saveWinnerPhoto(db,actor(),input({consentConfirmed:false}))).rejects.toMatchObject({status:422});
  tx.managedMedia.findUnique.mockResolvedValueOnce(null as never);await expect(saveWinnerPhoto(db,actor(),input())).rejects.toMatchObject({status:422});
  tx.managedMedia.findUnique.mockResolvedValueOnce({id:imageId,purpose:'CATALOG'});await expect(saveWinnerPhoto(db,actor(),input())).rejects.toMatchObject({status:422});expect(tx.winnerPresentation.upsert).not.toHaveBeenCalled();
 });
 it('permits replacement/reset later while rejecting stale editor versions',async()=>{
  const {tx,db}=fixture();await saveWinnerPhoto(db,actor(),input());
  await expect(saveWinnerPhoto(db,actor(),input({imageId:nextImage}))).rejects.toMatchObject({status:409});
  expect(await saveWinnerPhoto(db,actor(),input({version:1,imageId:nextImage}))).toMatchObject({version:2,imageId:nextImage});
  expect(await saveWinnerPhoto(db,actor(),input({version:2,imageId:null,consentConfirmed:false}))).toEqual({auctionId,version:3,imageId:null,path:null});
  expect(tx.winnerPresentation.upsert).toHaveBeenLastCalledWith(expect.objectContaining({update:{imageId:null,consentConfirmedAt:null,consentActorId:null,version:{increment:1}}}));
 });
 it('limits a fulfillment staff member to their assigned winner',async()=>{
  const {tx,db}=fixture(),member={...actor(),role:'FULFILLMENT' as const};tx.fulfillmentCase.findUnique.mockResolvedValueOnce({assignedTo:'other-staff'});
  await expect(saveWinnerPhoto(db,member,input())).rejects.toMatchObject({status:403});expect(tx.winnerPresentation.upsert).not.toHaveBeenCalled();
  expect(await saveWinnerPhoto(db,member,input())).toMatchObject({imageId,version:1});
 });
 it('rechecks current admin permission inside the transaction, audits and deduplicates a retry',async()=>{
  const {tx,client}=fixture(),raw=input();const first=await opsMutation(client,new Headers(),'winnerPhoto',raw);
  expect(await opsMutation(client,new Headers(),'winnerPhoto',raw)).toEqual(first);expect(tx.winnerPresentation.upsert).toHaveBeenCalledTimes(1);
  expect(requireAdmin).toHaveBeenCalledWith(expect.anything(),expect.anything(),{permission:'fulfillment',lock:true});
  expect(tx.adminAudit.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({actorId:'staff',action:'OPS_WINNERPHOTO',target:auctionId})}));
  expect(clearPublicDataCache).toHaveBeenCalledTimes(2);
  await expect(opsMutation(client,new Headers(),'winnerPhoto',input({imageId:nextImage}))).rejects.toMatchObject({status:409});expect(tx.winnerPresentation.upsert).toHaveBeenCalledTimes(1);
 });
 it('rejects forbidden callers and attempts to rewrite result fields',async()=>{
  const {client}=fixture();vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminError(403,'Denied'));
  await expect(opsMutation(client,new Headers(),'winnerPhoto',input())).rejects.toMatchObject({status:403});expect(client.$transaction).not.toHaveBeenCalled();
  expect(winnerPhotoSchema.safeParse({...input(),winningPoints:'0.01'}).success).toBe(false);
 });
});

describe('permanent winner-media purpose separation',()=>{
 const upload=async(purpose?:string)=>({key,mime:'image/png',data:(await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64'),sourceType:'SUPPLIED',sourceCredit:'Authorized fixture photograph',rightsConfirmed:true,...(purpose?{purpose}:{})});
 it('preserves ordinary catalog uploads and requires explicit winner-only purpose',async()=>{
  const catalog=fixture();expect(await adminMutation(catalog.client,new Headers(),'media',await upload())).toMatchObject({purpose:'CATALOG'});
  const personal=fixture();expect(await adminMutation(personal.client,new Headers(),'media',await upload('WINNER_PHOTO'))).toMatchObject({purpose:'WINNER_PHOTO'});
  expect(personal.tx.managedMedia.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({purpose:'WINNER_PHOTO'})}));
 });
 it('rechecks current owner permission before accepting a winner-photo upload',async()=>{
  const {client,tx}=fixture();vi.mocked(requireAdmin).mockResolvedValueOnce({...actor(),sessionId:'staff-session'} as Awaited<ReturnType<typeof requireAdmin>>).mockResolvedValueOnce({...actor(),role:'CATALOG_MANAGER',sessionId:'staff-session'} as Awaited<ReturnType<typeof requireAdmin>>);
  await expect(adminMutation(client,new Headers(),'media',await upload('WINNER_PHOTO'))).rejects.toMatchObject({status:403});expect(tx.managedMedia.create).not.toHaveBeenCalled();
 });
 it('rejects product and auction-presentation reuse of personal winner media',async()=>{
  const product=fixture();const raw={key,version:0,title:'Catalog item',slug:'catalog-item',description:'Catalog item description',condition:'New',categoryId:nextImage,isDemo:false,visible:true,imageIds:[imageId]};
  await expect(adminMutation(product.client,new Headers(),'product',raw)).rejects.toMatchObject({status:422});expect(product.tx.managedMedia.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:[imageId]},purpose:'CATALOG'}}));
  const presentation=fixture();presentation.tx.$queryRaw.mockResolvedValue([{id:auctionId}] as never);Object.assign(presentation.tx.auction,{findUniqueOrThrow:vi.fn(async()=>({controlVersion:0,publishedAt:f.now,status:'LIVE',settlement:null,result:null,product:{id:'catalog-product'}}))});
  await expect(adminMutation(presentation.client,new Headers(),'presentation',{key,auctionId,version:0,title:'Catalog item',description:'Catalog description',condition:'New',imageIds:[imageId],reason:'Correct catalog presentation'})).rejects.toMatchObject({status:422});
  expect(presentation.tx.managedMedia.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:[imageId]},purpose:'CATALOG'}}));
 });
 it('excludes winner photographs from the generic library and custom broadcasts',async()=>{
  const findMany=vi.fn(async()=>[]),count=vi.fn(async()=>0),library={managedMedia:{findMany,count}} as unknown as PrismaClient;
  expect(await workspaceRead(library,new Headers(),'media',new URLSearchParams())).toMatchObject({items:[],total:0});expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{purpose:'CATALOG'}}));expect(count).toHaveBeenCalledWith({where:{purpose:'CATALOG'}});
  const broadcast=fixture();await expect(opsMutation(broadcast.client,new Headers(),'broadcast',{key,reason:'Authorized catalog campaign',text:'A current auction',imageId,confirmation:'SEND'})).rejects.toMatchObject({status:422});
  expect(broadcast.tx.managedMedia.findFirst).toHaveBeenCalledWith({where:{id:imageId,purpose:'CATALOG'},select:{id:true}});
 });
});

function publicRow(change:Record<string,unknown>={}){
 return {slug:'original-item',code:'AUCTION-42',publicCode:42,status:'CLOSED',publishedAt:new Date('2026-10-29'),startsAt:new Date('2026-10-29'),endsAt:new Date('2026-10-29T23:00:00Z'),featured:false,isDemo:false,acceptedBidCount:2,publicViewCount:0n,presentation:null,fulfillmentSummary:'Collect item',fulfillmentSummaryAm:null,fulfillmentRegion:'Addis Ababa',fulfillmentRegionAm:null,
 product:{title:'Original product',titleAm:null,description:'Original description',descriptionAm:null,condition:'New',conditionAm:null,images:[{path:'/images/product.webp',alt:'Product',sourceType:'ORIGINAL',sourceCredit:null}]},category:{slug:'accessories',name:'Accessories',nameAm:null},
 terms:{version:1,ruleVersion:'lowest-unique-v4',minParticipants:2,minPoints:new Prisma.Decimal(1),maxPoints:null,stepPoints:new Prisma.Decimal('0.01'),entryFeePoints:new Prisma.Decimal(10),maxDistinctBids:100,noWinnerTerms:'Terms',cancellationTerms:'Terms',fulfillmentSnapshot:'Snapshot'},feeRevisions:[],result:null,
 settlement:{publication:{publishedAt:new Date('2026-01-01')},outcome:'WINNER',decision:'LOWEST_UNIQUE',winningPoints:new Prisma.Decimal('2.27'),completedAt:new Date('2026-10-29T23:00:00Z'),winner:{ownContact:{lastFour:'1234',revokedAt:null}}},winnerPresentation:{imageId,consentConfirmedAt:new Date('2026-10-29T23:30:00Z'),image:{purpose:'WINNER_PHOTO'}},...change} as Parameters<typeof toPublicAuction>[0];
}
describe('public winner photo privacy',()=>{
 it('exposes only the consented managed-media path after a real settled win',()=>{
  const result=toPublicAuction(publicRow(),f.now);expect(result.result?.winnerPhotoPath).toBe(`/api/media/${imageId}`);
  expect(result.result?.winningPoints).toBe('2.27');expect(result.product.images[0].path).toBe('/images/product.webp');
  expect(JSON.stringify(result)).not.toMatch(/consentActor|consentConfirmedAt|winnerUserId|staff-session/);expect(result.result?.winnerPhoneMasked).toBe('********34');
 });
 it.each([{winnerPresentation:null},{winnerPresentation:{imageId,consentConfirmedAt:null,image:{purpose:'WINNER_PHOTO'}}},{winnerPresentation:{imageId,consentConfirmedAt:new Date('2026-11-01'),image:{purpose:'WINNER_PHOTO'}}},{winnerPresentation:{imageId,consentConfirmedAt:new Date('2026-10-29'),image:{purpose:'CATALOG'}}},{isDemo:true}])('suppresses photos without eligible public consent: %j',change=>{
  expect(toPublicAuction(publicRow(change),f.now).result?.winnerPhotoPath).toBeNull();
 });
 it('never attaches a real person photo to illustrative or no-winner results',()=>{
  const row=publicRow();expect(toPublicAuction({...row,settlement:{...row.settlement!,outcome:'NO_WINNER'}},f.now).result?.winnerPhotoPath).toBeNull();
  expect(toPublicAuction({...row,settlement:null,result:{outcome:'WINNER',winningPoints:new Prisma.Decimal(1),explanation:'Example',isDemo:true,closedAt:new Date('2026-10-29'),publishedAt:new Date('2026-10-29')}},f.now).result?.winnerPhotoPath).toBeNull();
 });
});
