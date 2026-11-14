import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {campaignContent} from '../src/modules/notifications/campaigns';
import {encryptPhone} from '../src/modules/auth/own-contact';

const now=new Date('2026-11-10T10:00:00Z'),productId=randomUUID(),bannerId=randomUUID();
const caption=(content:Awaited<ReturnType<typeof campaignContent>>)=>content&&'telegramCaption' in content?String(content.telegramCaption):undefined;
const row={kind:'AUCTION_RESULT',payload:{auctionId:'auction',settlementId:'settlement',recipientUserId:'recipient',imagePath:'/api/media/'+productId}};
function fixture(change:Record<string,unknown>={}){
 const settlement={id:'settlement',outcome:'WINNER',ruleVersion:'lowest-unique-v4',decision:'LOWEST_UNIQUE',winningPoints:new Prisma.Decimal('0.54'),winnerUserId:'private-winner',winner:{name:'Bura',telegramUsername:'cryptonbozz',ownContact:{botId:'123456789',phoneCipher:encryptPhone('+251911652904','123456789'),revokedAt:null}},completedAt:new Date(now.getTime()-3000000),publication:{publishedAt:new Date(now.getTime()-10000)}};
 const item={slug:'power-bank',publicCode:42,publishedAt:new Date(now.getTime()-86400000),startsAt:new Date(now.getTime()-7200000),endsAt:new Date(now.getTime()-3600000),status:'CLOSED',isDemo:false,isSettlementFixture:false,testRunId:null,presentation:{title:'Power bank',images:[{path:'/api/media/'+productId}]},product:{title:'Power bank',visible:true},result:null,settlement,...change};
 const tx={auction:{findUnique:vi.fn(async()=>item)},winnerPresentation:{findFirst:vi.fn(async()=>({bannerImageId:bannerId}))},$queryRaw:vi.fn(async()=>[{now}])};
 return {tx,item,settlement,db:tx as unknown as Prisma.TransactionClient};
}

beforeEach(()=>{vi.stubEnv('TELEGRAM_BOT_TOKEN','123456789:fixture-token');vi.stubEnv('PHONE_CONTACT_KEY_ID','test');vi.stubEnv('PHONE_CONTACT_KEYS',JSON.stringify({test:'e'.repeat(64)}))});
afterEach(()=>vi.unstubAllEnvs());

describe('published result announcements',()=>{
 it('uses frozen product media and only concise safe winner facts with the exact result link',async()=>{
  const f=fixture(),content=await campaignContent(f.db,row);
  expect(content).toMatchObject({imageId:productId,imagePath:'/api/media/'+productId,href:'/winners/42',buttonLabel:'View result · ውጤቱን ይመልከቱ'});
  expect(caption(content)).toContain('Bura\n+251911***904');
  expect(caption(content)).toContain('ETB 0.54');expect(caption(content)).not.toMatch(/cryptonbozz|Lowest unique number|12:59 EAT|Entry|settlement/);
  expect(JSON.stringify(content)).not.toMatch(/private-winner|phoneCipher|consentConfirmedAt|251911652904/);
  expect(f.tx.winnerPresentation.findFirst).not.toHaveBeenCalled();
 });
 it('does not mutate queued images when a Winners banner/photo is added or replaced',async()=>{
  const f=fixture({presentation:{title:'Power bank',images:[{path:'/api/media/'+bannerId}]}});
  expect((await campaignContent(f.db,row))?.imagePath).toBe('/api/media/'+productId);
  f.tx.winnerPresentation.findFirst.mockResolvedValue({bannerImageId:randomUUID()});
  expect((await campaignContent(f.db,row))?.imagePath).toBe('/api/media/'+productId);
  expect(f.tx.winnerPresentation.findFirst).not.toHaveBeenCalled();
 });
 it('shows a legitimate legacy winner without adding another fallback announcement or algorithm text',async()=>{
  const f=fixture();f.item.settlement.decision='FIRST_ACCEPTED_LOWEST';
  const content=await campaignContent(f.db,row);expect(caption(content)).toContain('Bura');expect(caption(content)).toContain('ETB 0.54');expect(caption(content)).not.toMatch(/Earliest|fallback|unique|accepted/);
 });
 it.each(['NO_WINNER','CANCELLED'])('does not send a removed %s announcement',async outcome=>{
  const f=fixture();Object.assign(f.item,{status:outcome==='CANCELLED'?'CANCELLED':'CLOSED',settlement:{...f.settlement,outcome,winner:null,winningPoints:null}});
  expect(await campaignContent(f.db,row)).toBeNull();
 });
 it.each([{settlement:null},{status:'LIVE'},{isDemo:true},{testRunId:'private-test'}])('suppresses unpublished/private/incomplete results: %j',async change=>{
  expect(await campaignContent(fixture(change).db,row)).toBeNull();
 });
 it('suppresses future publication, incomplete winner facts and wrong settlement identifiers',async()=>{
  const f=fixture();f.item.settlement.publication.publishedAt=new Date(now.getTime()+1);expect(await campaignContent(f.db,row)).toBeNull();
  f.item.settlement.publication.publishedAt=now;f.item.settlement.decision='unknown';expect(await campaignContent(f.db,row)).toBeNull();
  f.item.settlement.decision='LOWEST_UNIQUE';expect(await campaignContent(f.db,{...row,payload:{...row.payload,settlementId:'different'}})).toBeNull();
 });
 it('never exposes phone-like display names, emails or invalid handles',async()=>{
  const f=fixture();f.item.settlement.winner.name='+251911652904';f.item.settlement.winner.telegramUsername='email@example.test';
  const content=await campaignContent(f.db,row);expect(caption(content)).not.toMatch(/251911652904|email@example/);expect(caption(content)).toContain('+251911***904');
 });
 it('keeps upcoming/live images separate from result announcement media',async()=>{
  const f=fixture({status:'LIVE',startsAt:new Date(now.getTime()-60000),endsAt:new Date(now.getTime()+3600000),settlement:null});
  expect(await campaignContent(f.db,{...row,kind:'AUCTION_ENDING_12_HOURS'})).toMatchObject({imagePath:'/api/media/'+productId});
 });
});
