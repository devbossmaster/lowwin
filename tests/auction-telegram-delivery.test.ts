import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrismaClient,Outbox} from '@prisma/client';
import {auctionNotificationImagePath,campaignContent} from '../src/modules/notifications/campaigns';
import {dispatchOne} from '../src/modules/notifications/service';
import {InputFile} from 'grammy';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';

const now=new Date('2026-10-30T09:00:00Z'),imageId='11111111-2222-4333-8444-555555555555';
const auction=(change:Record<string,unknown>={})=>({slug:'rugass-power-bank',publicCode:42,publishedAt:new Date(now.getTime()-60000),startsAt:new Date(now.getTime()+1800000),endsAt:new Date(now.getTime()+86400000),status:'SCHEDULED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Rugass 20,000 mAh power bank',images:[{path:`/api/media/${imageId}`}]},product:{title:'Original product title',visible:true,images:[]},result:null,settlement:null,...change});
const job=()=>({id:'auction-message',key:'global:starting-soon:auction:user:player',kind:'AUCTION_STARTING_SOON',payload:{auctionId:'auction',recipientUserId:'player'},state:'PENDING',attempts:0,nextAttemptAt:new Date(0),createdAt:new Date(0),sentAt:null,lastError:null,settlementId:null,testRunId:null}) as Outbox;
let photoBytes:Buffer;
beforeEach(async()=>{vi.stubEnv('MINI_APP_URL','https://lowwin.test');photoBytes=await sharp({create:{width:184,height:80,channels:3,background:'#c9a227'}}).png().toBuffer()});
afterEach(()=>vi.unstubAllEnvs());

function fixture(item=auction()){
 const row=job(),sendPhoto=vi.fn(async()=>({message_id:42})),sendMessage=vi.fn(async(_chat:string,_text:string,_options:unknown)=>({message_id:43}));
 const tx={
  $executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>null)},
  $queryRaw:vi.fn(async(query:TemplateStringsArray)=>query.join('').includes('FROM "Outbox"')?(row.state==='PENDING'?[row]:[]):[{now}]),
  auction:{findUnique:vi.fn(async()=>item)},notificationInbox:{upsert:vi.fn()},
  winnerPresentation:{findFirst:vi.fn(async()=>null as Record<string,unknown>|null)},
  user:{findUnique:vi.fn(async()=>({telegramId:'900000001',name:'Player name'}))},
  botChat:{findUnique:vi.fn(async()=>({telegramId:'900000001',chatId:'900000001',blocked:false}))},
  outbox:{update:vi.fn(async({data}:{data:Record<string,unknown>})=>Object.assign(row,data))},
  telegramMessage:{create:vi.fn(async()=>({id:'message'}))},managedMedia:{findUnique:vi.fn(async()=>({bytes:photoBytes}))},
 };
 return {row,tx,sendPhoto,sendMessage,client:{$transaction:async(callback:(value:unknown)=>unknown)=>callback(tx)} as unknown as PrismaClient,bot:{api:{sendPhoto,sendMessage}} as never};
}

describe('concise auction Telegram messages',()=>{
 it('delivers the actual displayed product image, concise title, EAT start time and one Mini App button',async()=>{
  const f=fixture();await dispatchOne(f.client,f.bot);
  expect(f.row.state).toBe('SENT');expect(f.sendMessage).not.toHaveBeenCalled();expect(f.tx.managedMedia.findUnique).toHaveBeenCalledWith({where:{id:imageId},select:{bytes:true}});
  expect(f.sendPhoto).toHaveBeenCalledWith('900000001',expect.any(InputFile),{
   caption:'⏰ Rugass 20,000 mAh power bank\nOpens within 1 hour · በ1 ሰዓት ውስጥ ይጀምራል\n🗓 30 Oct 2026, 12:30 EAT\n#42',
   reply_markup:{inline_keyboard:[[{text:'View auction · ጨረታውን ይመልከቱ',web_app:{url:'https://lowwin.test/auctions/rugass-power-bank'}}]]},
  });
 });
 it('sends text when no actual product image exists instead of the generic notification banner',async()=>{
  const f=fixture(auction({presentation:{title:'Rugass power bank'}}));await dispatchOne(f.client,f.bot);
  expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.sendMessage).toHaveBeenCalledTimes(1);
  expect(f.sendMessage.mock.calls[0][1]).toContain('Rugass power bank');expect(f.sendMessage.mock.calls[0][1]).not.toContain('@LowWinChat');
 });
 it('still delivers the auction text and button when the selected media was removed',async()=>{
  const f=fixture(auction({presentation:{title:'Missing image fixture',images:[{path:'/api/media/'+randomUUID()}]}}));f.tx.managedMedia.findUnique.mockResolvedValueOnce(null as never);
  await dispatchOne(f.client,f.bot);expect(f.row.state).toBe('SENT');expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.sendMessage).toHaveBeenCalledWith('900000001',expect.stringContaining('Missing image fixture'),expect.objectContaining({reply_markup:expect.any(Object)}));
 });
 it('keeps Telegram rate-limit backoff without sending a duplicate text message',async()=>{
  const f=fixture();f.sendPhoto.mockRejectedValueOnce({error_code:429,parameters:{retry_after:20}});await dispatchOne(f.client,f.bot);
  expect(f.row.state).toBe('PENDING');expect(f.row.lastError).toBe('RATE_LIMIT');expect(f.row.attempts).toBe(1);expect(f.sendPhoto).toHaveBeenCalledOnce();expect(f.sendMessage).not.toHaveBeenCalled();
 });
 it('uploads the approved winner photo for a published result and never resends a completed job',async()=>{
  const winnerId=randomUUID(),f=fixture(auction({status:'CLOSED',endsAt:new Date(now.getTime()-1000),settlement:{outcome:'WINNER',winnerUserId:'winner',completedAt:new Date(now.getTime()-1000),publication:{publishedAt:now}}}));f.row.kind='AUCTION_RESULT';
  f.tx.winnerPresentation.findFirst.mockResolvedValue({imageId:winnerId,consentConfirmedAt:now,image:{purpose:'WINNER_PHOTO'}});
  await dispatchOne(f.client,f.bot);expect(f.sendPhoto).toHaveBeenCalledOnce();expect(f.sendPhoto).toHaveBeenCalledWith('900000001',expect.any(InputFile),expect.objectContaining({caption:expect.stringContaining('Winner announced')}));expect(f.tx.managedMedia.findUnique).toHaveBeenCalledWith({where:{id:winnerId},select:{bytes:true}});
  expect(await dispatchOne(f.client,f.bot)).toBe(false);expect(f.sendPhoto).toHaveBeenCalledOnce();
 });
 it('falls back to the product photo when a consented winner image cannot be decoded',async()=>{
  const winnerId=randomUUID(),f=fixture(auction({status:'CLOSED',endsAt:new Date(now.getTime()-1000),settlement:{outcome:'WINNER',winnerUserId:'winner',completedAt:new Date(now.getTime()-1000),publication:{publishedAt:now}}}));f.row.kind='AUCTION_RESULT';
  f.tx.winnerPresentation.findFirst.mockResolvedValue({imageId:winnerId,consentConfirmedAt:now,image:{purpose:'WINNER_PHOTO'}});f.tx.managedMedia.findUnique.mockResolvedValueOnce({bytes:Buffer.from('corrupt-photo')});
  await dispatchOne(f.client,f.bot);expect(f.row.state).toBe('SENT');expect(f.sendPhoto).toHaveBeenCalledOnce();expect(f.sendMessage).not.toHaveBeenCalled();
 });
 it.each([{publishedAt:null},{publishedAt:new Date(now.getTime()+1)},{testRunId:'private'},{product:{visible:false}},{isDemo:true}])('never delivers unavailable or nonpublic product content %j',async change=>{
  const f=fixture(auction(change));await dispatchOne(f.client,f.bot);
  expect(f.sendPhoto).not.toHaveBeenCalled();expect(f.sendMessage).not.toHaveBeenCalled();expect(f.row.state).toBe('SKIPPED');
 });
 it('uses the own product image fallback and safely bounds a long product title',async()=>{
  const f=fixture(auction({presentation:{title:'A'.repeat(500)},product:{title:'Original',visible:true,images:[{path:'/products/power-bank.webp'}]}}));
  const content=await campaignContent(f.tx as never,f.row);
  expect(content?.imagePath).toBe('/products/power-bank.webp');
  expect(content&&'telegramCaption' in content?content.telegramCaption.length:0).toBeLessThan(300);
 });
 it.each(['https://other.example/product.png','//other.example/product.png','/images/../../secret.png','/api/private/image','/api/media/not-a-uuid'])('rejects unrelated or unsafe image paths: %s',path=>{
  expect(auctionNotificationImagePath({images:[{path}]})).toBeUndefined();
 });
});
