import {describe,it,expect,vi} from 'vitest';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {auctionNotificationImageId,campaignContent,expandCampaign,scheduleGlobalAlerts,telegramKinds} from '../src/modules/notifications/campaigns';
import {endingReminders,endingReminderCurrent,retiredNotificationKinds} from '../src/modules/notifications/policy';
import {notificationContent} from '../src/modules/notifications/service';
import {notificationCopy} from '../src/components/notification-copy';

const now=new Date('2026-11-14T09:00:00Z'),hour=3_600_000;
const row={kind:'AUCTION_UPCOMING',payload:{auctionId:'auction-1',recipientUserId:'player-1'}};
const auction=(change:Record<string,unknown>={})=>({id:'auction-1',slug:'fixture-phone',publicCode:42,publishedAt:new Date(now.getTime()-60000),startsAt:new Date(now.getTime()+9*hour),endsAt:new Date(now.getTime()+3*24*hour),status:'SCHEDULED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Fixture phone'},product:{title:'Old title',visible:true},result:null,settlement:null,...change});
const transaction=(a=auction())=>({auction:{findUnique:vi.fn(async()=>a)},$queryRaw:vi.fn(async()=>[{now}])}) as unknown as Prisma.TransactionClient;
function schedulerClient(data:Record<string,unknown>,halted=false):PrismaClient{
 const client={...data,$executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>halted?{action:'AUCTIONS_MAINTENANCE_HALTED',details:{},createdAt:now}:null)}};
 return Object.assign(client,{$transaction:async(callback:(tx:unknown)=>unknown)=>callback(client)}) as unknown as PrismaClient;
}
const root=(kind:string):Outbox=>({id:'root-1',key:'global:upcoming:auction-1',kind:'GLOBAL_CAMPAIGN',createdAt:now,payload:{auctionId:'auction-1',deliveryKind:kind,audienceBefore:now.toISOString()},testRunId:null,state:'PENDING',attempts:0,nextAttemptAt:now,sentAt:null,lastError:null,leaseToken:null,leaseUntil:null,claimedAt:null,settlementId:null});

describe('one upcoming reminder and four closing windows',()=>{
 it('announces a newly published auction separately from its scheduled reminder',async()=>{
  const content=await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+4*24*hour)})),{...row,kind:'AUCTION_PUBLISHED'});
  expect(content?.title).toContain('New auction');expect(content?.href).toBe('/auctions/fixture-phone');
 });
 it.each(endingReminders)('accepts only the live $kind window',async reminder=>{
  const content=await campaignContent(transaction(auction({status:'LIVE',startsAt:new Date(now.getTime()-hour),endsAt:new Date(now.getTime()+reminder.maxMs)})),{...row,kind:reminder.kind});
  expect(content?.title).toContain(reminder.en);expect(content?.body).toContain('Fixture phone');
  expect(notificationCopy(content!,'am').title).toContain(reminder.am);
  for(const offset of [reminder.minMs,reminder.maxMs+1,-1])expect(endingReminderCurrent(reminder.kind,new Date(now.getTime()+offset),now)).toBe(false);
 });
 it.each([0,1,12*hour,12*hour+1,24*hour,24*hour+1,48*hour,48*hour+1,72*hour,72*hour+1])('never catches up multiple closing notices at %i ms',offset=>{
  const matches=endingReminders.filter(r=>endingReminderCurrent(r.kind,new Date(now.getTime()+offset),now));
  expect(matches).toHaveLength(offset>0&&offset<=72*hour?1:0);
 });
 it.each([1,hour,24*hour])('uses the same upcoming notice throughout its day window (%i ms)',async offset=>{
  const content=await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row);
  expect(content?.title).toContain('within 1 day');expect(notificationCopy(content!,'am').body).toContain('የሚጀምርበት');
 });
 it.each([-1,0,24*hour+1])('suppresses an upcoming reminder outside its window (%i ms)',async offset=>{
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
 it('schedules durable distinct windows and upcoming day keys only once across repeated ticks',async()=>{
  const saved=new Map<string,unknown>();
  const createMany=vi.fn(async({data}:{data:Array<{key:string}>})=>{let count=0;for(const job of data)if(!saved.has(job.key)){saved.set(job.key,job);count++}return {count}});
  const findMany=vi.fn(async({where}:{where:{status:unknown;endsAt:{gt:Date;lte?:Date};startsAt:{gt?:Date}}})=>where.startsAt.gt?[{id:'upcoming',isDemo:false,isSettlementFixture:false}]:[{id:`closing-${where.endsAt.lte!.getTime()}`,isDemo:false,isSettlementFixture:false,controlVersion:7}]);
  const client=schedulerClient({$queryRaw:vi.fn(async()=>[{now}]),auction:{findMany},outbox:{createMany}});
  expect(await scheduleGlobalAlerts(client)).toBe(5);expect(await scheduleGlobalAlerts(client)).toBe(0);
  expect(saved.size).toBe(5);expect(saved.get('global:upcoming:upcoming')).toMatchObject({payload:{deliveryKind:'AUCTION_UPCOMING',audienceBefore:now.toISOString()}});
  expect([...saved.keys()].some(k=>k.includes('starting-soon'))).toBe(false);
  expect(findMany.mock.calls[4][0].where.startsAt).toEqual({gt:now,lte:new Date(now.getTime()+24*hour)});
  for(const reminder of endingReminders)expect([...saved.entries()].some(([key,value])=>key.startsWith(`global:${reminder.key}:`)&&key.endsWith(':v7')&&(value as {payload:{deliveryKind:string}}).payload.deliveryKind===reminder.kind)).toBe(true);
 });
 it('does not inspect auctions or create jobs during maintenance',async()=>{
  const findMany=vi.fn(),createMany=vi.fn();expect(await scheduleGlobalAlerts(schedulerClient({auction:{findMany},outbox:{createMany}},true))).toBe(0);expect(findMany).not.toHaveBeenCalled();expect(createMany).not.toHaveBeenCalled();
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
