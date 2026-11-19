import {describe,expect,it,vi} from 'vitest';
import {auctionBroadcastDraft} from '../src/modules/admin/auction-broadcast';
const now=new Date('2026-11-14T10:00:00Z'),id='75a96ae3-fbf0-4b20-8e56-083e7f235bc2',image='/api/media/11111111-2222-4333-8444-555555555555';
const auction=(change:Record<string,unknown>={})=>({id,publicCode:42,status:'LIVE',startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+1000),publishedAt:new Date(now.getTime()-2000),isDemo:false,testRunId:null,presentation:{title:'Live power bank',titleAm:'ተንቀሳቃሽ ቻርጀር',images:[{path:image}]},settlement:null,result:null,product:{title:'Previous title',visible:true,images:[]},...change});
const tx=(item:ReturnType<typeof auction>|null)=>({auction:{findUnique:vi.fn(async()=>item)},outbox:{create:vi.fn(),upsert:vi.fn()},$queryRaw:vi.fn()});
describe('live auction broadcast review',()=>{
 it('previews the published photo and short Amharic caption and button without queuing',async()=>{
  const db=tx(auction()),draft=await auctionBroadcastDraft(db as never,id,now);
  expect(draft).toMatchObject({auctionId:id,title:'ተንቀሳቃሽ ቻርጀር',text:'ተንቀሳቃሽ ቻርጀር\n\nጨረታው ሊያበቃ ከ1 ሰዓት ያነሰ ጊዜ ቀርቷል።',imagePath:image,miniAppPath:'/auctions/42',buttonLabel:'እናሸንፍ!'});
  expect(draft.draftHash).toMatch(/^[a-f0-9]{64}$/);expect(db.outbox.create).not.toHaveBeenCalled();expect(db.outbox.upsert).not.toHaveBeenCalled();
 });
 it.each([[49,'2 ቀናት ቀርተዋል'],[24,'1 ቀን ቀርቷል'],[23.5,'23 ሰዓታት ቀርተዋል'],[1,'1 ሰዓት ቀርቷል']])('shows one remaining-time unit for %d hours',async(hours,remaining)=>{
  const draft=await auctionBroadcastDraft(tx(auction({endsAt:new Date(now.getTime()+hours*3600000)})) as never,id,now);
  expect(draft.text).toBe(`ተንቀሳቃሽ ቻርጀር\n\nጨረታው ሊያበቃ ${remaining}።`);
 });
 it('uses an Amharic heading even for a product without an Amharic title',async()=>{
  const presentation={title:'Live power bank',titleAm:'Untranslated',images:[{path:image}]};
  const draft=await auctionBroadcastDraft(tx(auction({presentation})) as never,id,now);
  expect(draft.title).toBe('የሎውዊን ጨረታ');
  expect(draft.text).toMatch(/^የሎውዊን ጨረታ\n/);
 });
 it('updates the time shown at confirmation while requiring a new review after deadline, title or image changes',async()=>{
  const item=auction({endsAt:new Date(now.getTime()+3600000)});
  const one=await auctionBroadcastDraft(tx(item) as never,id,now);
  const later=await auctionBroadcastDraft(tx(item) as never,id,new Date(now.getTime()+1000));
  expect(later.text).not.toBe(one.text);
  expect(later.draftHash).toBe(one.draftHash);
  for(const change of [{endsAt:new Date(now.getTime()+3601000)},{presentation:{...item.presentation,titleAm:'አዲስ ዕቃ'}},{presentation:{...item.presentation,images:[{path:'/images/changed.webp'}]}}]){
   const changed=await auctionBroadcastDraft(tx({...item,...change}) as never,id,now);
   expect(changed.draftHash).not.toBe(one.draftHash);
  }
 });
 it('accepts a started SCHEDULED auction before the worker changes its raw status',async()=>{
  expect(await auctionBroadcastDraft(tx(auction({status:'SCHEDULED'})) as never,id,now)).toMatchObject({auctionId:id,miniAppPath:'/auctions/42'});
 });
 it('uses the authoritative database clock when no trusted timestamp is provided',async()=>{
  const db=tx(auction({status:'SCHEDULED'}));db.$queryRaw.mockResolvedValue([{now}] as never);
  expect(await auctionBroadcastDraft(db as never,id)).toMatchObject({auctionId:id});expect(db.$queryRaw).toHaveBeenCalledOnce();
 });
 it.each([null,{status:'CANCELLED'},{startsAt:new Date(now.getTime()+1)},{endsAt:now},{publishedAt:null},{publishedAt:new Date(now.getTime()+1)},{publicCode:null},{publicCode:0},{isDemo:true},{testRunId:'fixture'},{settlement:{id:'settled'}},{result:{id:'historic-result'}},{product:{visible:false}},{category:{visible:false}},{product:{visible:true,category:{visible:false}}}])('rejects an auction that is no longer accepting public bids %j',async change=>{
  await expect(auctionBroadcastDraft(tx(change===null?null:auction(change)) as never,id,now)).rejects.toMatchObject({status:422});
 });
 it.each(['https://elsewhere.example/product.jpg','/api/private/image','/images/../../secret.png'])('rejects a nonpublic or unsafe photo %s',async path=>{
  await expect(auctionBroadcastDraft(tx(auction({presentation:{title:'Item',images:[{path}]}})) as never,id,now)).rejects.toMatchObject({status:422});
 });
});
