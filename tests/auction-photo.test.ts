import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {InputFile} from 'grammy';
import {auctionPhoto} from '../src/modules/notifications/auction-photo';

describe('auction notification images',()=>{
 it('uploads immutable media bytes once and reuses the prepared photo',async()=>{
  const id=randomUUID(),bytes=await sharp({create:{width:1840,height:800,channels:3,background:'#c9a227'}}).webp().toBuffer(),findUnique=vi.fn(async()=>({bytes})),tx={managedMedia:{findUnique}} as never;
  expect(await auctionPhoto(tx,'/api/media/'+id)).toBeInstanceOf(InputFile);expect(await auctionPhoto(tx,'/api/media/'+id)).toBeInstanceOf(InputFile);expect(findUnique).toHaveBeenCalledOnce();expect(findUnique).toHaveBeenCalledWith({where:{id},select:{bytes:true}});
 });
 it('uses a local product WebP without a public HTTP download',async()=>{
  const findUnique=vi.fn();expect(await auctionPhoto({managedMedia:{findUnique}} as never,'/images/lowwin-demo-headphones.webp')).toBeInstanceOf(InputFile);expect(findUnique).not.toHaveBeenCalled();
 });
 it('allows a text fallback for missing or damaged images',async()=>{
  expect(await auctionPhoto({managedMedia:{findUnique:vi.fn(async()=>null)}} as never,'/api/media/'+randomUUID())).toBeNull();
  expect(await auctionPhoto({managedMedia:{findUnique:vi.fn(async()=>({bytes:Buffer.from('damaged')}))}} as never,'/api/media/'+randomUUID())).toBeNull();
  expect(await auctionPhoto({} as never,'/images/missing-auction-image.webp')).toBeNull();
 });
 it.each(['https://other.example/photo.png','/images/../../secret.png','/api/private/image'])('rejects unsafe or unrelated paths %s',async path=>{
  const findUnique=vi.fn();expect(await auctionPhoto({managedMedia:{findUnique}} as never,path)).toBeNull();expect(findUnique).not.toHaveBeenCalled();
 });
});
