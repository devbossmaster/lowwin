import {describe,it,expect,vi} from 'vitest';
import type {Prisma,PrismaClient,Outbox} from '@prisma/client';
import {auctionNotificationImageId,campaignContent,expandCampaign,scheduleGlobalAlerts,telegramKinds} from '../src/modules/notifications/campaigns';
import {notificationContent,telegramCampaignText} from '../src/modules/notifications/service';
import {notificationCopy} from '../src/components/notification-copy';

const now=new Date('2026-10-05T09:00:00Z');
const row={kind:'AUCTION_UPCOMING',payload:{auctionId:'auction-1',recipientUserId:'player-1'}};
const auction=(change:Record<string,unknown>={})=>({id:'auction-1',slug:'fixture-phone',publicCode:42,publishedAt:new Date(now.getTime()-60000),startsAt:new Date('2026-10-05T18:00:00Z'),endsAt:new Date('2026-10-07T18:00:00Z'),status:'SCHEDULED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Fixture phone'},product:{title:'Old title',visible:true},result:null,settlement:null,...change});
const transaction=(a=auction())=>({auction:{findUnique:vi.fn(async()=>a)},$queryRaw:vi.fn(async()=>[{now}])}) as unknown as Prisma.TransactionClient;
function schedulerClient(data:Record<string,unknown>,halted=false):PrismaClient{
 const client={...data,$executeRaw:vi.fn(async()=>0),adminAudit:{findFirst:vi.fn(async()=>halted?{action:'AUCTIONS_MAINTENANCE_HALTED',details:{},createdAt:now}:null)}};
 return Object.assign(client,{$transaction:async(callback:(tx:unknown)=>unknown)=>callback(client)}) as unknown as PrismaClient;
}

describe('upcoming auction reminders',()=>{
 it('announces a published upcoming auction even when it starts more than a day later',async()=>{
  const content=await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+3*86400000)})),{...row,kind:'AUCTION_PUBLISHED'});
  expect(content?.title).toContain('New auction');expect(content?.body).toContain('Fixture phone');expect(content?.href).toBe('/auctions/fixture-phone');
 });
 it('queues the closing-day reminder only once per schedule version across repeated ticks',async()=>{
  const saved=new Map<string,unknown>(),createMany=vi.fn(async({data}:{data:Array<{key:string}>})=>{let count=0;for(const job of data)if(!saved.has(job.key)){saved.set(job.key,job);count++}return {count}});
  const findMany=vi.fn(async({where}:{where:{startsAt:{lte?:Date}}})=>where.startsAt.lte?.getTime()===now.getTime()?[{id:'auction-1',isDemo:false,isSettlementFixture:false,controlVersion:7}]:[]);
  const client=schedulerClient({$queryRaw:vi.fn(async()=>[{now}]),auction:{findMany},outbox:{createMany}});
  expect(await scheduleGlobalAlerts(client)).toBe(1);expect(await scheduleGlobalAlerts(client)).toBe(0);
  expect(saved.get('global:ending:auction-1:v7')).toMatchObject({payload:{deliveryKind:'AUCTION_ENDING',audienceBefore:now.toISOString()}});
 });
 it.each([1,86399999])('sends the closing-day notice only while a live auction has less than a day remaining (%i ms)',async offset=>{
  const content=await campaignContent(transaction(auction({startsAt:new Date(now.getTime()-60000),endsAt:new Date(now.getTime()+offset)})),{...row,kind:'AUCTION_ENDING'});
  expect(content?.title).toContain('Less than one day left');
 });
 it.each([0,86400000,86400001])('does not send a closing-day notice outside its exact window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()-60000),endsAt:new Date(now.getTime()+offset)})),{...row,kind:'AUCTION_ENDING'})).toBeNull();
 });
 it('suppresses queued cancellation results for the bot and Mini App bell',async()=>{
  const cancelled=auction({status:'CANCELLED',settlement:{outcome:'CANCELLED',decision:'OWNER_CANCELLED',publication:{publishedAt:now}}});
  const result={kind:'AUCTION_RESULT',payload:{auctionId:'auction-1',recipientUserId:'player-1'}};
  expect(await campaignContent(transaction(cancelled),result)).toBeNull();
  expect(await notificationContent(transaction(cancelled),{kind:'AUCTION_CANCELLED',payload:{auctionId:'auction-1',recipientUserId:'player-1'}})).toBeNull();

  const tx={auctionSettlement:{findUnique:vi.fn(async()=>({outcome:'CANCELLED',publication:{publishedAt:now}}))},user:{findMany:vi.fn()},outbox:{createMany:vi.fn(),update:vi.fn()}} as unknown as Prisma.TransactionClient;
  const root:Outbox={id:'cancelled-root',key:'settlement:cancelled:completed',kind:'AUCTION_FINALIZED',createdAt:now,payload:{auctionId:'auction-1'},testRunId:null,state:'PENDING',attempts:0,nextAttemptAt:now,sentAt:null,lastError:null,settlementId:'cancelled'};
  expect(await expandCampaign(tx,root)).toBe(0);
  expect(tx.user.findMany).not.toHaveBeenCalled();
 expect(tx.outbox.update).toHaveBeenCalledWith({where:{id:root.id},data:{state:'SKIPPED',lastError:'CANCELLATION_SILENT'}});
 });
 it('keeps completed winner results available for bot delivery',async()=>{
  vi.stubEnv('MINI_APP_URL','https://lowwin.example');
  try{
   const completed=auction({status:'CLOSED',settlement:{outcome:'WINNER',publication:{publishedAt:now}}});
   const content=await campaignContent(transaction(completed),{kind:'AUCTION_RESULT',payload:{auctionId:'auction-1',recipientUserId:'player-1'}});
   expect(content?.body).toContain('A winner has been announced.');
  }finally{vi.unstubAllEnvs()}
 });
 it('uses the displayed product PNG for the one-hour reminder and rejects unrelated paths',async()=>{
  const current='11111111-2222-4333-8444-555555555555',original='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const item=auction({presentation:{title:'Fixture phone',images:[{path:`/api/media/${current}`}]},product:{title:'Old title',visible:true,images:[{path:`/api/media/${original}`}]},startsAt:new Date(now.getTime()+30*60000)});
  const content=await campaignContent(transaction(item),{...row,kind:'AUCTION_STARTING_SOON'});
  expect(content?.imageId).toBe(current);
  expect(content?.kind).toBe('AUCTION_STARTING_SOON');
  expect(auctionNotificationImageId(null,`/api/media/${original}`)).toBe(original);
  expect(auctionNotificationImageId({images:[{path:'https://elsewhere.example/image.png'}]},`/api/media/${original}`)).toBeUndefined();
 });
 it('spaces the personalized bilingual reminder into readable blocks',async()=>{
  expect(telegramKinds).toContain('AUCTION_UPCOMING');
  const content=await campaignContent(transaction(),row);
  expect(content).toMatchObject({kind:'AUCTION_UPCOMING',userId:'player-1',href:'/auctions/fixture-phone'});
  expect(content!.title).toContain('Bidding opens within 24 hours');
  expect(content!.body).toContain('Fixture phone · #42');expect(content!.body).toContain('5 Oct 2026, 21:00 EAT');
  expect(notificationCopy(content!,'en').body).not.toMatch(/[\u1200-\u137f]/);
  expect(notificationCopy(content!,'am').body).toContain('የሚጀምርበት ጊዜ');
  expect(notificationCopy(content!,'am').title).toContain('24');
  const caption=telegramCampaignText(content!.kind,content!.title,content!.body,'Bura');
  expect(caption).toMatch(/^Bura,\n\n⏰ Bidding opens within 24 hours/);
  expect(caption).toContain('\n\nFixture phone · #42\n\nOpens:');
  expect(caption).toContain('\n\nPreview the item before bidding opens.');
  expect(caption).toContain('@lowwinet');expect(caption).toContain('@LowWinChat');
 });
 it('uses a distinct one-hour reminder and skips the late 24-hour message',async()=>{
  const item=auction({startsAt:new Date(now.getTime()+30*60000)});
  expect(await campaignContent(transaction(item),row)).toBeNull();
  const content=await campaignContent(transaction(item),{...row,kind:'AUCTION_STARTING_SOON'});
  expect(content?.title).toContain('Bidding opens within 1 hour');
  expect(notificationCopy(content!,'am').title).toContain('1 ሰዓት');
  expect(notificationCopy(content!,'en').body).toContain('Get ready to bid');
  expect(telegramCampaignText(content!.kind,content!.title,content!.body,'Bura')).toContain('\n\nGet ready to bid when it opens.');
 });
 it.each([-1,0,86400000,86400001])('suppresses delivery outside the upcoming window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row)).toBeNull();
 });
 it.each([3600001,86399999])('accepts a still-upcoming auction inside the 24-hour window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),row)).not.toBeNull();
 });
 it.each([-1,0,3600001])('suppresses the one-hour reminder outside its window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),{...row,kind:'AUCTION_STARTING_SOON'})).toBeNull();
 });
 it.each([1,3600000])('accepts the one-hour reminder inside its window (%i ms)',async offset=>{
  expect(await campaignContent(transaction(auction({startsAt:new Date(now.getTime()+offset)})),{...row,kind:'AUCTION_STARTING_SOON'})).not.toBeNull();
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
  const findMany=vi.fn(async({where}:{where:{startsAt:{gt?:Date;lt?:Date}}})=>where.startsAt.gt?.getTime()===now.getTime()+3600000?[{id:'auction-1',isDemo:false,isSettlementFixture:false}]:[]);
  const client=schedulerClient({$queryRaw:vi.fn(async()=>[{now}]),auction:{findMany},outbox:{createMany}});
  expect(await scheduleGlobalAlerts(client)).toBe(1);expect(await scheduleGlobalAlerts(client)).toBe(0);
  expect(saved.size).toBe(1);expect(saved.get('global:upcoming:auction-1')).toMatchObject({kind:'GLOBAL_CAMPAIGN',payload:{auctionId:'auction-1',deliveryKind:'AUCTION_UPCOMING',rootKey:'global:upcoming:auction-1',audienceBefore:now.toISOString()}});
  const upcomingQuery=findMany.mock.calls[1][0];
  expect(upcomingQuery.where.startsAt).toEqual({gt:new Date(now.getTime()+3600000),lt:new Date(now.getTime()+86400000)});
 });
 it('queues the one-hour reminder once with its own campaign key',async()=>{
  const saved=new Map<string,unknown>(),createMany=vi.fn(async({data}:{data:Array<{key:string}>})=>{let count=0;for(const job of data)if(!saved.has(job.key)){saved.set(job.key,job);count++}return {count}});
  const findMany=vi.fn(async({where}:{where:{startsAt:{gt?:Date;lte?:Date}}})=>where.startsAt.gt?.getTime()===now.getTime()&&where.startsAt.lte?[{id:'auction-1',isDemo:false,isSettlementFixture:false}]:[]);
  const client=schedulerClient({$queryRaw:vi.fn(async()=>[{now}]),auction:{findMany},outbox:{createMany}});
  expect(await scheduleGlobalAlerts(client)).toBe(1);expect(await scheduleGlobalAlerts(client)).toBe(0);
  expect(saved.get('global:starting-soon:auction-1')).toMatchObject({kind:'GLOBAL_CAMPAIGN',payload:{deliveryKind:'AUCTION_STARTING_SOON',auctionId:'auction-1'}});
  expect(findMany.mock.calls[2][0].where.startsAt).toEqual({gt:now,lte:new Date(now.getTime()+3600000)});
 });
 it('does not inspect auctions or create jobs during reset maintenance',async()=>{
  const findMany=vi.fn(),createMany=vi.fn(),client=schedulerClient({auction:{findMany},outbox:{createMany}},true);
  expect(await scheduleGlobalAlerts(client)).toBe(0);expect(findMany).not.toHaveBeenCalled();expect(createMany).not.toHaveBeenCalled();
 });
 it('expands reminders into distinct durable recipient keys and retries without duplicate jobs',async()=>{
  const keys=new Set<string>(),createMany=vi.fn(async({data}:{data:Array<{key:string;kind:string}>})=>{let count=0;for(const r of data)if(!keys.has(r.key)){expect(r.kind).toBe('AUCTION_UPCOMING');keys.add(r.key);count++}return {count}});
  const tx={user:{findMany:vi.fn(async()=>[{id:'player-1'},{id:'player-2'}])},outbox:{createMany,update:vi.fn()}} as unknown as Prisma.TransactionClient;
  const root:Outbox={id:'root-1',key:'global:upcoming:auction-1',kind:'GLOBAL_CAMPAIGN',createdAt:now,payload:{auctionId:'auction-1',deliveryKind:'AUCTION_UPCOMING',audienceBefore:now.toISOString()},testRunId:null,state:'PENDING',attempts:0,nextAttemptAt:now,sentAt:null,lastError:null,settlementId:null};
  await expandCampaign(tx,root);await expandCampaign(tx,root);
  expect([...keys]).toEqual(['global:upcoming:auction-1:user:player-1','global:upcoming:auction-1:user:player-2']);
 });
});
