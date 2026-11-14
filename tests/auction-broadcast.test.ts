import {describe,expect,it,vi} from 'vitest';
import {auctionBroadcastDraft} from '../src/modules/admin/auction-broadcast';
const now=new Date('2026-11-14T10:00:00Z'),id='75a96ae3-fbf0-4b20-8e56-083e7f235bc2',image='/api/media/11111111-2222-4333-8444-555555555555';
const auction=(change:Record<string,unknown>={})=>({id,publicCode:42,status:'LIVE',startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+1000),publishedAt:new Date(now.getTime()-2000),isDemo:false,testRunId:null,presentation:{title:'Live power bank',titleAm:'ተንቀሳቃሽ ቻርጀር',images:[{path:image}]},settlement:null,result:null,product:{title:'Previous title',visible:true,images:[]},...change});
const tx=(item:ReturnType<typeof auction>|null)=>({auction:{findUnique:vi.fn(async()=>item)},outbox:{create:vi.fn(),upsert:vi.fn()},$queryRaw:vi.fn()});
describe('live auction broadcast review',()=>{
 it('prepares current public image, bilingual invitation and exact auction button without queuing',async()=>{
  const db=tx(auction()),draft=await auctionBroadcastDraft(db as never,id,now);
  expect(draft).toMatchObject({auctionId:id,title:'Live power bank',imagePath:image,miniAppPath:'/auctions/42',buttonLabel:'Bid now · አሁን ይጫረቱ'});
  expect(draft.text).toContain('Come and join');expect(draft.text).toContain('ተንቀሳቃሽ ቻርጀር');expect(draft.draftHash).toMatch(/^[a-f0-9]{64}$/);expect(db.outbox.create).not.toHaveBeenCalled();expect(db.outbox.upsert).not.toHaveBeenCalled();
 });
 it('pins approval to reviewed title and image, so changed public content requires review again',async()=>{
  const one=await auctionBroadcastDraft(tx(auction()) as never,id,now),same=await auctionBroadcastDraft(tx(auction()) as never,id,now);
  expect(same.draftHash).toBe(one.draftHash);
  for(const presentation of [{title:'Updated title',images:[{path:image}]},{title:'Live power bank',images:[{path:'/images/changed.webp'}]}])expect((await auctionBroadcastDraft(tx(auction({presentation})) as never,id,now)).draftHash).not.toBe(one.draftHash);
 });
 it.each([null,{status:'SCHEDULED'},{status:'CANCELLED'},{startsAt:new Date(now.getTime()+1)},{endsAt:now},{publishedAt:null},{publishedAt:new Date(now.getTime()+1)},{publicCode:null},{publicCode:0},{isDemo:true},{testRunId:'fixture'},{settlement:{id:'settled'}},{result:{id:'historic-result'}},{product:{visible:false}}])('rejects an auction that is no longer accepting public bids %j',async change=>{
  await expect(auctionBroadcastDraft(tx(change===null?null:auction(change)) as never,id,now)).rejects.toMatchObject({status:422});
 });
 it.each(['https://elsewhere.example/product.jpg','/api/private/image','/images/../../secret.png'])('rejects a nonpublic or unsafe photo %s',async path=>{
  await expect(auctionBroadcastDraft(tx(auction({presentation:{title:'Item',images:[{path}]}})) as never,id,now)).rejects.toMatchObject({status:422});
 });
});
