import {describe,expect,it,vi} from 'vitest';
import type {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {campaignContent} from '../src/modules/notifications/campaigns';

const now=new Date('2026-10-31T10:00:00Z'),productId=randomUUID(),winnerId=randomUUID();
const photo=()=>({imageId:winnerId,consentConfirmedAt:new Date(now.getTime()-1000),image:{purpose:'WINNER_PHOTO'}});
const row={kind:'AUCTION_RESULT',payload:{auctionId:'auction',recipientUserId:'recipient'}};
function fixture(change:Record<string,unknown>={},winnerPhoto:unknown=photo()){
 const item={slug:'power-bank',publicCode:42,publishedAt:new Date(now.getTime()-86400000),startsAt:new Date(now.getTime()-7200000),endsAt:new Date(now.getTime()-3600000),status:'CLOSED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Power bank',images:[{path:'/api/media/'+productId}]},product:{title:'Power bank',visible:true},result:null,settlement:{outcome:'WINNER',winnerUserId:'private-winner',completedAt:new Date(now.getTime()-3000000),publication:{publishedAt:new Date(now.getTime()-10000)}},...change};
 const tx={auction:{findUnique:vi.fn(async()=>item)},winnerPresentation:{findFirst:vi.fn(async()=>winnerPhoto)},$queryRaw:vi.fn(async()=>[{now}])};
 return {tx,db:tx as unknown as Prisma.TransactionClient};
}
describe('published winner photo in result notifications',()=>{
 it('prefers the approved winner photo and retains the original product image as a fallback',async()=>{
  const f=fixture(),content=await campaignContent(f.db,row);expect(content).toMatchObject({imageId:winnerId,imagePath:'/api/media/'+winnerId,fallbackImagePath:'/api/media/'+productId});
  expect(JSON.stringify(content)).not.toMatch(/private-winner|consentConfirmedAt|winnerUserId|phone/);
  expect(f.tx.winnerPresentation.findFirst).toHaveBeenCalledWith({where:{auctionId:'auction',auction:{is:expect.objectContaining({product:{is:{visible:true,category:{visible:true}}},category:{is:{visible:true}},terms:{isNot:null}})}},select:{imageId:true,consentConfirmedAt:true,image:{select:{purpose:true}}}});
 });
 it.each([null,{...photo(),imageId:null},{...photo(),consentConfirmedAt:null},{...photo(),consentConfirmedAt:new Date(now.getTime()+1)},{...photo(),image:{purpose:'CATALOG'}},{...photo(),imageId:'invalid-id'}])('keeps the product image without an eligible current photo: %j',async winnerPhoto=>{
  expect(await campaignContent(fixture({},winnerPhoto).db,row)).toMatchObject({imagePath:'/api/media/'+productId,fallbackImagePath:undefined});
 });
 it.each([{settlement:{outcome:'NO_WINNER',completedAt:new Date(now.getTime()-1000),publication:{publishedAt:now}}},{settlement:{outcome:'WINNER',winnerUserId:null,completedAt:now,publication:{publishedAt:now}}},{settlement:{outcome:'WINNER',winnerUserId:'winner',completedAt:new Date(now.getTime()+1),publication:{publishedAt:now}}},{status:'LIVE'}])('does not select a personal image without a completed genuine win: %j',async change=>{
  const f=fixture(change);expect(await campaignContent(f.db,row)).toMatchObject({imagePath:'/api/media/'+productId});expect(f.tx.winnerPresentation.findFirst).not.toHaveBeenCalled();
 });
 it.each([{settlement:{outcome:'WINNER',publication:null}},{settlement:{outcome:'WINNER',publication:{publishedAt:new Date(now.getTime()+1)}}},{isDemo:true},{testRunId:'private-test'}])('never exposes the photo before public eligibility: %j',async change=>{
  const f=fixture(change);expect(await campaignContent(f.db,row)).toBeNull();expect(f.tx.winnerPresentation.findFirst).not.toHaveBeenCalled();
 });
 it('rechecks replacement and withdrawal for later recipients without creating another job',async()=>{
  const f=fixture(),replacement=randomUUID();f.tx.winnerPresentation.findFirst.mockResolvedValueOnce(photo()).mockResolvedValueOnce({...photo(),imageId:replacement}).mockResolvedValueOnce(null);
  expect((await campaignContent(f.db,row))?.imagePath).toBe('/api/media/'+winnerId);expect((await campaignContent(f.db,row))?.imagePath).toBe('/api/media/'+replacement);expect((await campaignContent(f.db,row))?.imagePath).toBe('/api/media/'+productId);expect(f.tx.winnerPresentation.findFirst).toHaveBeenCalledTimes(3);
 });
 it('keeps upcoming/live promotion images separate from winner photos',async()=>{
  const f=fixture({status:'LIVE',startsAt:new Date(now.getTime()-60000),endsAt:new Date(now.getTime()+3600000),settlement:null});
  expect(await campaignContent(f.db,{...row,kind:'AUCTION_ENDING'})).toMatchObject({imagePath:'/api/media/'+productId});expect(f.tx.winnerPresentation.findFirst).not.toHaveBeenCalled();
 });
});
