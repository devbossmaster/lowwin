import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Prisma,PrismaClient} from '@prisma/client';
import sharp from 'sharp';
import {saveWinnerBanner,winnerBannerSchema} from '../src/modules/admin/winner-banner';
import {adminMutation} from '../src/modules/admin/operations';
import {opsMutation} from '../src/modules/admin/ops';
import {requireAdmin} from '../src/modules/admin/boundary';
const f=vi.hoisted(()=>({now:new Date('2026-11-10T12:00:00Z')}));
vi.mock('../src/modules/admin/boundary',()=>({requireAdmin:vi.fn(async()=>({id:'staff',role:'OWNER',sessionId:'fixture',now:f.now}))}));
vi.mock('../src/modules/cache/public-data',()=>({clearPublicDataCache:vi.fn(async()=>{}),cachedPublicData:(_key:string,_ttl:number,load:()=>unknown)=>load()}));
const auctionId='00000000-1111-4222-8333-444444444444',imageId='10000000-1111-4222-8333-444444444444',key='30000000-1111-4222-8333-444444444444';
const actor=()=>({id:'staff',role:'OWNER' as const,now:f.now});
const input=(change:Record<string,unknown>={})=>winnerBannerSchema.parse({key,auctionId,version:0,imageId,consentConfirmed:true,reason:'Winners banner rights and consent checked',...change});
function fixture(previous:Record<string,unknown>|null=null){
 let presentation=previous;
 const tx={
  $queryRaw:vi.fn(async()=>[]),$executeRaw:vi.fn(async()=>0),
  auction:{findUnique:vi.fn(async()=>({status:'CLOSED',isDemo:false,testRunId:null,publishedAt:new Date('2026-11-01'),settlement:{outcome:'WINNER',winnerUserId:'winner',completedAt:new Date('2026-11-09')}}))},
  managedMedia:{findUnique:vi.fn(async()=>({id:imageId,purpose:'WINNER_BANNER',mime:'image/webp'})),create:vi.fn(async({data}:{data:Record<string,unknown>})=>({id:imageId,...data}))},
  winnerPresentation:{findUnique:vi.fn(async()=>presentation),upsert:vi.fn(async({create,update}:{create:Record<string,unknown>;update:Record<string,unknown>})=>{presentation=presentation?{...presentation,...update,version:Number(presentation.version)+1}:{...create,version:1};return presentation})},
  adminAudit:{findFirst:vi.fn(async()=>null),findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({}))},
 };
 const client={$transaction:vi.fn(async(run:(value:unknown)=>unknown)=>run(tx))} as unknown as PrismaClient;
 return {tx,client,db:tx as unknown as Prisma.TransactionClient};
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireAdmin).mockResolvedValue({...actor(),sessionId:'fixture'} as Awaited<ReturnType<typeof requireAdmin>>)});
describe('Winners presentation-only mutation',()=>{
 it('adds a separate banner without mutating result, product, publication, ledger or jobs',async()=>{
  const {tx,db}=fixture();expect(await saveWinnerBanner(db,actor(),input())).toMatchObject({version:1,presentationMode:'BANNER',path:`/api/media/${imageId}`});
  expect(tx.winnerPresentation.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({bannerImageId:imageId,bannerConsentActorId:'staff',bannerConsentConfirmedAt:f.now,presentationMode:'BANNER'})}));
  expect(Object.keys(tx.auction)).toEqual(['findUnique']);expect(Object.keys(tx)).not.toContain('product');expect(Object.keys(tx)).not.toContain('resultPublication');expect(Object.keys(tx)).not.toContain('outbox');expect(Object.keys(tx)).not.toContain('journal');
 });
 it('replaces/removes the display while retaining historical photograph evidence and checking versions',async()=>{
  const historical={auctionId,imageId:'old-photo',consentActorId:'original-owner',consentConfirmedAt:new Date('2026-01-01'),version:4,presentationMode:'PHOTO'},f=fixture(historical);
  await expect(saveWinnerBanner(f.db,actor(),input())).rejects.toMatchObject({status:409});
  await saveWinnerBanner(f.db,actor(),input({version:4}));
  await saveWinnerBanner(f.db,actor(),input({version:5,imageId:null,consentConfirmed:false}));
  const update=f.tx.winnerPresentation.upsert.mock.calls[1][0].update;
  expect(update).toEqual({presentationMode:'PRODUCT',bannerImageId:null,bannerConsentConfirmedAt:null,bannerConsentActorId:null,version:{increment:1}});
  expect(update).not.toHaveProperty('imageId');expect(update).not.toHaveProperty('consentActorId');
 });
 it('requires current administrator authority, explicit rights and purpose-bound WebP',async()=>{
  const {db,tx}=fixture();await expect(saveWinnerBanner(db,{...actor(),role:'FULFILLMENT'},input())).rejects.toMatchObject({status:403});
  await expect(saveWinnerBanner(db,actor(),input({consentConfirmed:false}))).rejects.toMatchObject({status:422});
  tx.managedMedia.findUnique.mockResolvedValue({id:imageId,purpose:'WINNER_PHOTO',mime:'image/png'});await expect(saveWinnerBanner(db,actor(),input())).rejects.toMatchObject({status:422});expect(tx.winnerPresentation.upsert).not.toHaveBeenCalled();
  expect(winnerBannerSchema.safeParse({...input(),winningPoints:'1'}).success).toBe(false);
 });
 it.each(['resultPublish','winnerPhoto'] as const)('rejects retired %s commands without any mutation',async action=>{
  const {client}=fixture();await expect(opsMutation(client,new Headers(),action,{})).rejects.toMatchObject({status:410});expect(requireAdmin).toHaveBeenCalled();expect(client.$transaction).not.toHaveBeenCalled();
 });
});
describe('complete banner image normalization',()=>{
 const upload=async()=>({key,mime:'image/jpeg',purpose:'WINNER_BANNER',sourceType:'SUPPLIED',sourceCredit:'Authorized synthetic fixture banner',rightsConfirmed:true,data:(await sharp({create:{width:2300,height:1000,channels:3,background:'#c4a127'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'private fixture'}}}).toBuffer()).toString('base64')});
 it('reencodes validated contents to canonical WebP and strips metadata',async()=>{
  const {tx,client}=fixture();await adminMutation(client,new Headers(),'media',await upload());const data=tx.managedMedia.create.mock.calls[0][0].data,bytes=data.bytes as Uint8Array;
  expect(data).toMatchObject({purpose:'WINNER_BANNER',mime:'image/webp'});const metadata=await sharp(bytes).metadata();expect(metadata).toMatchObject({format:'webp',width:1840,height:800});expect(metadata.exif).toBeUndefined();expect(metadata.xmp).toBeUndefined();expect(bytes.byteLength).toBeLessThanOrEqual(2097152);
 });
 it('rejects a spoofed MIME and missing upload consent',async()=>{
  const first=fixture();await expect(adminMutation(first.client,new Headers(),'media',{...await upload(),mime:'image/png'})).rejects.toMatchObject({status:422});expect(first.tx.managedMedia.create).not.toHaveBeenCalled();
  const second=fixture();await expect(adminMutation(second.client,new Headers(),'media',{...await upload(),rightsConfirmed:undefined})).rejects.toMatchObject({status:403});expect(second.tx.managedMedia.create).not.toHaveBeenCalled();
 });
});
