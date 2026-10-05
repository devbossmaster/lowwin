import {describe,it,expect,vi} from 'vitest';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {auctionNotificationImageId,campaignContent,expandCampaign,scheduleGlobalAlerts,telegramKinds} from '../src/modules/notifications/campaigns';
import {notificationCopy} from '../src/components/notification-copy';
import {withTelegramCommunity} from '../src/lib/telegram-community';

const now=new Date('2026-10-05T09:00:00Z');
const row={kind:'AUCTION_UPCOMING',payload:{auctionId:'auction-1',recipientUserId:'player-1'}};
const auction=(change:Record<string,unknown>={})=>({id:'auction-1',slug:'fixture-phone',publicCode:42,publishedAt:new Date(now.getTime()-60000),startsAt:new Date('2026-10-05T18:00:00Z'),endsAt:new Date('2026-10-07T18:00:00Z'),status:'SCHEDULED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Fixture phone'},product:{title:'Old title',visible:true},result:null,settlement:null,...change});
const transaction=(a=auction())=>({auction:{findUnique:vi.fn(async()=>a)},$queryRaw:vi.fn(async()=>[{now}])}) as unknown as Prisma.TransactionClient;

describe('upcoming auction reminders',()=>{
 it('uses the displayed product PNG for auction notifications and rejects unrelated paths',async()=>{
  const current='11111111-2222-4333-8444-555555555555',original='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const content=await campaignContent(transaction(auction({presentation:{title:'Fixture phone',images:[{path:`/api/media/${current}`}]},product:{title:'Old title',visible:true,images:[{path:`/api/media/${original}`}]}})),row);
  expect(content?.imageId).toBe(current);
  expect(auctionNotificationImageId(null,`/api/media/${original}`)).toBe(original);
  expect(auctionNotificationImageId({images:[{path:'https://elsewhere.example/image.png'}]},`/api/media/${original}`)).toBeUndefined();
 });
 it('uses the existing bilingual campaign style, EAT start time and community footer',async()=>{
  expect(telegramKinds).toContain('AUCTION_UPCOMING');
  const content=await campaignContent(transaction(),row);
  expect(content).toMatchObject({kind:'AUCTION_UPCOMING',userId:'player-1',href:'/auctions/fixture-phone'});
  expect(content!.title).toContain('Starts in less than 24 hours');
  expect(content!.body).toContain('Fixture phone · #42');expect(content!.body).toContain('5 Oct 2026, 21:00 EAT');
  expect(notificationCopy(content!,'en').body).not.toMatch(/[\u1200-\u137f]/);
  expect(notificationCopy(content!,'am').body).toContain('የሚጀምርበት ጊዜ');
  expect(notificationCopy(content!,'am').title).toContain('24');
  const caption=withTelegramCommunity(`${content!.title}\n${content!.body}`);
  expect(caption).toContain('@lowwinet');expect(caption).toContain('@LowWinChat');
 });
 it.each([-1,0,86400000,86400001])('suppresses delivery outside the upcoming window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row)).toBeNull();
 });
 it.each([1,86399999])('accepts a still-upcoming auction inside the window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row)).not.toBeNull();
 });
 it.each([
  {status:'CANCELLED'},{status:'DRAFT'},{publishedAt:null},{startsAt:null},{endsAt:now},
  {product:{visible:false}},{isDemo:true},{testRunId:'private-test'},
  {result:{id:'historic-result'}},{settlement:{outcome:'WINNER'}},
 ])('suppresses unavailable/private/finished auctions %j',async change=>{
  expect(await campaignContent(transaction(auction(change)),row)).toBeNull();
 });
 it('queues one durable campaign despite repeated scheduler ticks',async()=>{
  const saved=new Map<string,unknown>();
  const createMany=vi.fn(async({data}:{data:Array<{key:string}>})=>{let count=0;for(const r of data)if(!saved.has(r.key)){saved.set(r.key,r);count++}return {count}});
  const findMany=vi.fn(async({where}:{where:{startsAt:{gt?:Date;lt?:Date}}})=>where.startsAt.gt?[{id:'auction-1',isDemo:false,isSettlementFixture:false}]:[]);
  const client={$queryRaw:vi.fn(async()=>[{now}]),auction:{findMany},outbox:{createMany}} as unknown as PrismaClient;
  expect(await scheduleGlobalAlerts(client)).toBe(1);expect(await scheduleGlobalAlerts(client)).toBe(0);
  expect(saved.size).toBe(1);expect(saved.get('global:upcoming:auction-1')).toMatchObject({kind:'GLOBAL_CAMPAIGN',payload:{auctionId:'auction-1',deliveryKind:'AUCTION_UPCOMING',rootKey:'global:upcoming:auction-1',audienceBefore:now.toISOString()}});
  const upcomingQuery=findMany.mock.calls[1][0];
  expect(upcomingQuery.where.startsAt).toEqual({gt:now,lt:new Date(now.getTime()+86400000)});
 });
 it('expands reminders into distinct durable recipient keys and retries without duplicate jobs',async()=>{
  const keys=new Set<string>(),createMany=vi.fn(async({data}:{data:Array<{key:string;kind:string}>})=>{let count=0;for(const r of data)if(!keys.has(r.key)){expect(r.kind).toBe('AUCTION_UPCOMING');keys.add(r.key);count++}return {count}});
  const tx={user:{findMany:vi.fn(async()=>[{id:'player-1'},{id:'player-2'}])},outbox:{createMany,update:vi.fn()}} as unknown as Prisma.TransactionClient;
  const root:Outbox={id:'root-1',key:'global:upcoming:auction-1',kind:'GLOBAL_CAMPAIGN',createdAt:now,payload:{auctionId:'auction-1',deliveryKind:'AUCTION_UPCOMING',audienceBefore:now.toISOString()},testRunId:null,state:'PENDING',attempts:0,nextAttemptAt:now,sentAt:null,lastError:null,settlementId:null};
  await expandCampaign(tx,root);await expandCampaign(tx,root);
  expect([...keys]).toEqual(['global:upcoming:auction-1:user:player-1','global:upcoming:auction-1:user:player-2']);
 });
});
