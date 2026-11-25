import {describe,it,expect,vi} from 'vitest';
import type {Prisma,Outbox} from '@prisma/client';
import {auctionNotificationImageId,campaignContent,expandCampaign,telegramKinds} from '../src/modules/notifications/campaigns';
import {endingReminders,endingReminderCurrent,retiredNotificationKinds,upcomingReminders,upcomingReminderCurrent} from '../src/modules/notifications/policy';
import {notificationContent} from '../src/modules/notifications/service';
import {notificationCopy} from '../src/components/notification-copy';

const now=new Date('2026-11-14T09:00:00Z'),hour=3_600_000;
const row={kind:'AUCTION_UPCOMING',payload:{auctionId:'auction-1',recipientUserId:'player-1'}};
const auction=(change:Record<string,unknown>={})=>({id:'auction-1',slug:'fixture-phone',publicCode:42,publishedAt:new Date(now.getTime()-60000),startsAt:new Date(now.getTime()+9*hour),endsAt:new Date(now.getTime()+3*24*hour),status:'SCHEDULED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Fixture phone'},product:{title:'Old title',visible:true},result:null,settlement:null,...change});
const transaction=(a=auction())=>({auction:{findUnique:vi.fn(async()=>a)},$queryRaw:vi.fn(async()=>[{now}])}) as unknown as Prisma.TransactionClient;
const root=(kind:string):Outbox=>({id:'root-1',key:'global:upcoming:auction-1',kind:'GLOBAL_CAMPAIGN',createdAt:now,payload:{auctionId:'auction-1',deliveryKind:kind,audienceBefore:now.toISOString()},testRunId:null,state:'PENDING',attempts:0,nextAttemptAt:now,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null});

describe('two upcoming reminders and five closing windows',()=>{
 it('announces a newly published auction separately from its scheduled reminder',async()=>{
  const future=transaction(auction({startsAt:new Date(now.getTime()+4*24*hour)}));
  const content=await campaignContent(future,{...row,kind:'AUCTION_UPCOMING_ADDED'});
  expect(content?.title).toContain('አዲስ መጪ ጨረታ');expect(content?.href).toBe('/auctions/fixture-phone');
  expect(await campaignContent(future,{...row,kind:'AUCTION_PUBLISHED'})).toBeNull();
  const live=transaction(auction({status:'LIVE',startsAt:new Date(now.getTime()-hour)}));
  expect((await campaignContent(live,{...row,kind:'AUCTION_PUBLISHED'}))?.title).toContain('አዲስ ጨረታ ተጀምሯል');
  expect(await campaignContent(live,{...row,kind:'AUCTION_UPCOMING_ADDED'})).toBeNull();
 });
 it.each(endingReminders)('accepts only the live $kind window',async reminder=>{
  const content=await campaignContent(transaction(auction({status:'LIVE',startsAt:new Date(now.getTime()-hour),endsAt:new Date(now.getTime()+reminder.maxMs)})),{...row,kind:reminder.kind});
  expect(content?.title).toContain('ጨረታው ሊያበቃ');expect(content?.body).toContain('Fixture phone');
  expect(notificationCopy(content!,'am').title).toBe(content?.title);
  for(const offset of [reminder.minMs,reminder.maxMs+1,-1])expect(endingReminderCurrent(reminder.kind,new Date(now.getTime()+offset),now)).toBe(false);
 });
 it('reports the actual 5 hours and 13 minutes remaining and the 24-hour Addis deadline',async()=>{
  const db=transaction(auction({status:'LIVE',startsAt:new Date(now.getTime()-hour),endsAt:new Date(now.getTime()+5*hour+13*60_000)}));
  const content=await campaignContent(db,{...row,kind:'AUCTION_ENDING_12_HOURS'});
  expect(content).toMatchObject({title:'ጨረታው ሊያበቃ 5 ሰዓታት ከ13 ደቂቃዎች ቀርቷል',body:expect.stringContaining('17:13 (አዲስ አበባ)'),telegramCaption:expect.stringContaining('5 ሰዓታት ከ13 ደቂቃዎች')});
 });
 it('describes a reminder delivered in the final minute without rounding up',async()=>{
  const db=transaction(auction({status:'LIVE',startsAt:new Date(now.getTime()-hour),endsAt:new Date(now.getTime()+15_000)}));
  expect(await campaignContent(db,{...row,kind:'AUCTION_ENDING_1_HOUR'})).toMatchObject({title:'ጨረታው ሊያበቃ ከ1 ደቂቃ ያነሰ ጊዜ ቀርቷል'});
 });
 it.each([0,1,hour,hour+1,12*hour,12*hour+1,24*hour,24*hour+1,48*hour,48*hour+1,72*hour,72*hour+1])('never catches up multiple closing notices at %i ms',offset=>{
  const matches=endingReminders.filter(r=>endingReminderCurrent(r.kind,new Date(now.getTime()+offset),now));
  expect(matches).toHaveLength(offset>0&&offset<=72*hour?1:0);
 });
 it.each(upcomingReminders)('accepts only its own upcoming $kind window',async reminder=>{
  const content=await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+reminder.maxMs)})),{...row,kind:reminder.kind});
  expect(content?.title).toContain('ጨረታው ሊጀምር');expect(content?.body).toContain('የሚጀምርበት');
  for(const offset of [reminder.minMs,reminder.maxMs+1,-1])expect(upcomingReminderCurrent(reminder.kind,new Date(now.getTime()+offset),now)).toBe(false);
 });
 it.each([-1,0,hour,24*hour+1])('suppresses a day reminder outside its window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row)).toBeNull();
 });
 it.each([{status:'CANCELLED'},{status:'DRAFT'},{publishedAt:null},{startsAt:null},{endsAt:now},{product:{visible:false}},{isDemo:true},{testRunId:'private-test'},{result:{id:'historic-result'}},{settlement:{outcome:'WINNER'}}])('suppresses unavailable/private/finished auctions %j',async change=>{
  expect(await campaignContent(transaction(auction(change)),row)).toBeNull();
 });
 it('uses published product media and refuses an unrelated remote image',async()=>{
  const current='11111111-2222-4333-8444-555555555555',original='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const content=await campaignContent(transaction(auction({presentation:{title:'Fixture phone',images:[{path:`/api/media/${current}`}]}})),row);
  expect(content?.imageId).toBe(current);expect(auctionNotificationImageId(null,`/api/media/${original}`)).toBe(original);
  expect(auctionNotificationImageId({images:[{path:'https://elsewhere.example/image.png'}]},`/api/media/${original}`)).toBeUndefined();
 });
 it.each(retiredNotificationKinds)('retires queued %s before fanout or private content reads',async kind=>{
  const update=vi.fn(),query=vi.fn(),tx={outbox:{update},$queryRaw:query} as unknown as Prisma.TransactionClient;
  expect(await expandCampaign(tx,root(kind))).toBe(0);expect(query).not.toHaveBeenCalled();expect(update).toHaveBeenCalledWith({where:{id:'root-1'},data:{state:'SKIPPED',lastError:'NOTIFICATION_RETIRED'}});
  expect(await notificationContent(tx,{...row,kind})).toBeNull();expect(telegramKinds).not.toContain(kind);
 });
 it('expands stable recipient keys with duplicate-safe replay',async()=>{
  const keys=new Set<string>(),createMany=vi.fn(async({data}:{data:Array<{key:string;kind:string}>})=>{let count=0;for(const job of data)if(!keys.has(job.key)){expect(job.kind).toBe('AUCTION_UPCOMING');keys.add(job.key);count++}return {count}});
  const tx={$queryRaw:vi.fn(async()=>[{id:'player-1'},{id:'player-2'}]),outbox:{createMany,update:vi.fn()}} as unknown as Prisma.TransactionClient;
  await expandCampaign(tx,root('AUCTION_UPCOMING'));await expandCampaign(tx,root('AUCTION_UPCOMING'));
  expect([...keys]).toEqual(['global:upcoming:auction-1:user:player-1','global:upcoming:auction-1:user:player-2']);
 });
});
