import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {resendBroadcast,broadcastTarget,deleteBroadcastMessages} from '../src/modules/admin/broadcast-history';
import {expandBroadcastDeletion,telegramMessageDeletable} from '../src/modules/notifications/broadcast-delete';
import {dispatchBatch} from '../src/modules/notifications/dispatch';
import {notificationDispatchFixture} from './notification-dispatch-fixture';

const now=new Date('2026-11-18T08:00:00Z'),imagePath='/images/lowwin-demo-headphones.webp';
const root=()=>({id:'campaign-original',key:'broadcast:owner:original',kind:'GLOBAL_CAMPAIGN',state:'SENT',lastError:null,payload:{rootKey:'broadcast:owner:original',deliveryKind:'BROADCAST',body:'Beta service update',href:'/',buttonLabel:'Open Lowwin',imagePath}});
function fixture(){
 const original=root(),upsert=vi.fn(async({create}:{create:Record<string,unknown>})=>({id:'new-campaign',...create}));
 return {original,tx:{outbox:{findUnique:vi.fn(async()=>original),upsert,update:vi.fn(),updateMany:vi.fn(async()=>({count:2})),count:vi.fn(async()=>1)},$queryRaw:vi.fn(async(_query?:unknown)=>[{now}]),$executeRaw:vi.fn(),managedMedia:{findFirst:vi.fn()},auction:{findUnique:vi.fn()}}};
}
afterEach(()=>vi.unstubAllEnvs());
describe('direct original-content broadcast actions',()=>{
 it('resends original imagePath, caption, button and destination with a new linked campaign and fresh audience cutoff',async()=>{
  const f=fixture(),before=structuredClone(f.original);
  expect(await resendBroadcast(f.tx as never,f.original.id,'broadcast:owner:intentional-resend')).toMatchObject({id:'new-campaign',parentCampaignId:f.original.id,state:'PENDING'});
  expect(f.tx.outbox.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{key:'broadcast:owner:intentional-resend'},create:expect.objectContaining({payload:expect.objectContaining({imagePath,body:before.payload.body,href:'/',buttonLabel:'Open Lowwin',parentCampaignId:before.id,audienceBefore:now.toISOString(),rootKey:'broadcast:owner:intentional-resend'})}),update:{}}));
  expect(f.original).toEqual(before);expect(f.tx.outbox.update).not.toHaveBeenCalled();
 });
 it('keeps the authorized custom cover ID when resending a broadcast',async()=>{
  const f=fixture(),imageId='11111111-2222-4333-8444-555555555555';
  const {imagePath:_,...message}=f.original.payload;
  Object.assign(f.original,{payload:{...message,imageId}});
  f.tx.managedMedia.findFirst.mockResolvedValue({id:imageId});
  await resendBroadcast(f.tx as never,f.original.id,'broadcast:owner:media-resend');
  expect(f.tx.managedMedia.findFirst).toHaveBeenCalledWith({where:{id:imageId,purpose:'CATALOG'},select:{id:true}});
  expect(f.tx.outbox.upsert.mock.calls[0][0].create.payload).toMatchObject({imageId});
 });
 it('uses idempotent queue identity for duplicate confirmations while intentional later resends get a fresh identity',async()=>{
  const f=fixture();for(const key of ['broadcast:owner:one','broadcast:owner:one','broadcast:owner:two'])await resendBroadcast(f.tx as never,f.original.id,key);
  expect(f.tx.outbox.upsert.mock.calls.map(([call])=>(call as unknown as {where:{key:string}}).where.key)).toEqual(['broadcast:owner:one','broadcast:owner:one','broadcast:owner:two']);
 });
 it('keeps the countdown metadata when a generated auction promotion is resent',async()=>{
  const f=fixture(),promotionTitle='ተንቀሳቃሽ ቻርጀር';
  Object.assign(f.original.payload,{href:'/auctions/42',auctionId:'auction',promotionTitle});
  f.tx.auction.findUnique.mockResolvedValue({id:'auction',publicCode:42,slug:'fixture',status:'LIVE',startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+1000),publishedAt:now,isDemo:false,testRunId:null,settlement:null,result:null,product:{visible:true}});
  await resendBroadcast(f.tx as never,f.original.id,'broadcast:owner:promotion-resend');
  expect(f.tx.outbox.upsert.mock.calls[0][0].create.payload).toMatchObject({auctionId:'auction',promotionTitle});
 });
 it('rechecks a linked auction using database time and permits started SCHEDULED, rejecting deadline or hidden changes',async()=>{
  const f=fixture(),auction={id:'auction',publicCode:42,slug:'fixture',status:'SCHEDULED',startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+1000),publishedAt:new Date(now.getTime()-2000),isDemo:false,testRunId:null,settlement:null,result:null,product:{visible:true}};
  f.tx.auction.findUnique.mockImplementation(async()=>auction as never);
  expect(await broadcastTarget(f.tx as never,'/auctions/42')).toEqual({href:'/auctions/42',auctionId:'auction'});
  auction.endsAt=now;await expect(broadcastTarget(f.tx as never,'/auctions/42')).rejects.toMatchObject({status:422,message:'The bidding deadline has passed.'});
  expect(f.tx.$queryRaw).toHaveBeenCalled();
 });
 it('rejects invalid historical media, recipient rows masquerading as campaign roots and unavailable catalog images',async()=>{
  const f=fixture();f.original.payload.imagePath='https://example.invalid/image.jpg';await expect(resendBroadcast(f.tx as never,f.original.id,'broadcast:new')).rejects.toMatchObject({status:422});
  f.original.payload.imagePath='/api/media/11111111-2222-4333-8444-555555555555';f.tx.managedMedia.findFirst.mockResolvedValue(null as never);await expect(resendBroadcast(f.tx as never,f.original.id,'broadcast:new')).rejects.toMatchObject({status:422});
  f.original.kind='BROADCAST';await expect(resendBroadcast(f.tx as never,f.original.id,'broadcast:new')).rejects.toMatchObject({status:404});
  expect(f.tx.outbox.upsert).not.toHaveBeenCalled();
 });
 it('deletion marks Stop and queues an idempotent control intent without deleting shared media or history',async()=>{
  const f=fixture();expect(await deleteBroadcastMessages(f.tx as never,f.original.id)).toMatchObject({stopped:true,remainingStopped:2,leasedAtStop:1,deletionJobId:'new-campaign'});
  expect(f.tx.outbox.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{key:'broadcast-delete:campaign-original'},create:expect.objectContaining({kind:'BROADCAST_DELETE',payload:{campaignId:f.original.id,campaignRootKey:f.original.key}}),update:{}}));
  expect(f.tx.outbox.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'SKIPPED',lastError:'CAMPAIGN_STOPPED'})}));
 });
});

describe('bounded durable broadcast deletion',()=>{
 it('keeps the exact Telegram 48-hour boundary and rejects future sent timestamps',()=>{
  expect(telegramMessageDeletable(new Date(now.getTime()-48*3600000+1),now)).toBe(true);
  expect(telegramMessageDeletable(new Date(now.getTime()-48*3600000),now)).toBe(false);
  expect(telegramMessageDeletable(new Date(now.getTime()+1),now)).toBe(false);
 });
 it('queues only recorded, available messages in bounded batches and preserves expired records as unavailable',async()=>{
  const f=fixture(),original=f.original;original.lastError='CAMPAIGN_STOPPED' as never;
  const messages=[{id:'available',sentAt:new Date(now.getTime()-1000),testRunId:null},{id:'expired',sentAt:new Date(now.getTime()-48*3600000),testRunId:null}];
  const query=vi.fn(async(query:{sql?:string})=>query.sql?.includes('FROM "TelegramMessage"')?messages:[{now}]);Object.assign(f.tx,{$queryRaw:query,telegramMessage:{updateMany:vi.fn()}});Object.assign(f.tx.outbox,{createMany:vi.fn()});f.tx.outbox.count.mockResolvedValue(0);
  const job={id:'deletion',payload:{campaignId:original.id,campaignRootKey:original.key}} as unknown as Outbox;
  await expandBroadcastDeletion(f.tx as never,job);
  expect((f.tx.outbox as unknown as {createMany:ReturnType<typeof vi.fn>}).createMany).toHaveBeenCalledWith({data:[{key:'telegram-delete:available',kind:'TELEGRAM_DELETE',payload:{telegramMessageId:'available',campaignId:original.id},testRunId:null}],skipDuplicates:true});
  expect((f.tx as unknown as {telegramMessage:{updateMany:ReturnType<typeof vi.fn>}}).telegramMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['expired']},deletionState:'DELIVERED'},data:expect.objectContaining({deletionState:'UNAVAILABLE',deletionError:'TELEGRAM_DELETE_WINDOW_EXPIRED'})}));
  expect(f.tx.outbox.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'SENT'})}));
  const scan=query.mock.calls.findIndex(([q])=>q.sql?.includes('FROM "TelegramMessage"'));expect(query.mock.calls[scan][0].sql).toContain('LIMIT 250');
  expect(f.tx.outbox.count.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[scan]);
 });
 it('waits durably for a send already in HTTP so its later acknowledgement is not missed',async()=>{
  const f=fixture();f.original.lastError='CAMPAIGN_STOPPED' as never;
  f.tx.$queryRaw.mockImplementation(async(query:unknown)=>'sql'in(query as object)?[]:[{now}]);
  Object.assign(f.tx,{telegramMessage:{updateMany:vi.fn()}});Object.assign(f.tx.outbox,{createMany:vi.fn()});
  await expandBroadcastDeletion(f.tx as never,{id:'deletion',payload:{campaignId:f.original.id,campaignRootKey:f.original.key}} as unknown as Outbox);
  expect(f.tx.outbox.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'PENDING',lastError:'WAITING_FOR_SEND_ACKNOWLEDGEMENTS'})}));
 });
 it('rechecks the deletion deadline immediately before HTTP, including after rate waiting',async()=>{
  const time=new Date(),row={id:'delete-job',key:'telegram-delete:message',kind:'TELEGRAM_DELETE',payload:{telegramMessageId:'message'},createdAt:time,nextAttemptAt:new Date(0),state:'PENDING',attempts:0,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null,testRunId:null} as Outbox;
  const f=notificationDispatchFixture([row],time),update=vi.fn();Object.assign(f.tx.telegramMessage,{findUnique:vi.fn(async()=>({id:'message',chatId:'900000001',messageId:1n,sentAt:new Date(time.getTime()-49*3600000),deletionState:'QUEUED'})),update});
  const remove=vi.fn();await dispatchBatch(f.client,{api:{deleteMessage:remove}} as never,{limit:1});
  expect(remove).not.toHaveBeenCalled();expect(row).toMatchObject({state:'SKIPPED',lastError:'TELEGRAM_DELETE_WINDOW_EXPIRED'});expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({deletionState:'UNAVAILABLE'})}));
 });
 it('respects Telegram deletion retry_after and retains a retryable pending result',async()=>{
  const time=new Date(),row={id:'delete-job',key:'telegram-delete:message',kind:'TELEGRAM_DELETE',payload:{telegramMessageId:'message'},createdAt:time,nextAttemptAt:new Date(0),state:'PENDING',attempts:0,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null,testRunId:null} as Outbox;
  const f=notificationDispatchFixture([row],time),update=vi.fn();Object.assign(f.tx.telegramMessage,{findUnique:vi.fn(async()=>({id:'message',chatId:'900000001',messageId:1n,sentAt:time,deletionState:'QUEUED'})),update});
  await dispatchBatch(f.client,{api:{deleteMessage:vi.fn(async()=>{throw {error_code:429,parameters:{retry_after:19}}})}} as never,{limit:1});
  expect(row).toMatchObject({state:'PENDING',lastError:'RATE_LIMIT',attempts:1});expect(row.nextAttemptAt.getTime()-Date.now()).toBeGreaterThan(18000);expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({deletionState:'FAILED',deletionError:'DELETE_RETRY'})}));
 });
});
