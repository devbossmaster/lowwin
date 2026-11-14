import {describe,it,expect,vi} from 'vitest';
import type {Prisma,Outbox} from '@prisma/client';
import {expandParticipantResults} from '../src/modules/notifications/participant-results';

const now=new Date('2026-11-14T10:00Z');
const row={id:'old-root',kind:'AUCTION_PARTICIPANTS',payload:{auctionId:'auction-1',settlementId:'settlement-1'},settlementId:'settlement-1',testRunId:null} as unknown as Outbox;
const settlement=(change:Record<string,unknown>={})=>({id:'settlement-1',outcome:'WINNER',winnerUserId:'winner-1',completedAt:new Date(now.getTime()-1000),cutoff:new Date(now.getTime()-2000),publication:{publishedAt:new Date(now.getTime()-500)},...change});
const fixture=(s:ReturnType<typeof settlement>|null=settlement())=>{
 const createMany=vi.fn(async()=>({count:1})),update=vi.fn(async()=>({}));
 const tx={auctionSettlement:{findUnique:vi.fn(async()=>s)},$queryRaw:vi.fn(async()=>[{now}]),outbox:{createMany,update}} as unknown as Prisma.TransactionClient;
 return {tx,createMany,update};
};
describe('legacy participant-result compatibility',()=>{
 it('queues only the published authoritative winner using the direct publication canonical key',async()=>{
  const {tx,createMany,update}=fixture();
  expect(await expandParticipantResults(tx,row)).toBe(1);
  expect(createMany).toHaveBeenCalledWith({data:[expect.objectContaining({key:'settlement:settlement-1:winner:winner-1',kind:'WINNER_CONGRATULATIONS',payload:{auctionId:'auction-1',settlementId:'settlement-1',recipientUserId:'winner-1'}})],skipDuplicates:true});
  expect(update).toHaveBeenCalledWith({where:{id:'old-root'},data:{state:'SENT',sentAt:now}});
 });
 it.each([null,settlement({outcome:'NO_UNIQUE',winnerUserId:null}),settlement({publication:null}),settlement({cutoff:new Date(now.getTime()+1)}),settlement({completedAt:new Date(now.getTime()+1)}),settlement({publication:{publishedAt:new Date(now.getTime()+1)}}),settlement({id:'other-settlement'})])('never sends participants or unpublished/wrong settlement evidence',async s=>{
  const {tx,createMany,update}=fixture(s);
  expect(await expandParticipantResults(tx,row)).toBe(0);
  expect(createMany).not.toHaveBeenCalled();expect(update).toHaveBeenCalledWith(expect.objectContaining({data:{state:'SKIPPED',lastError:'RESULT_NOT_PUBLISHED'}}));
 });
 it('does not revive a retired result-delivery job',async()=>{
  const {tx,createMany}=fixture();expect(await expandParticipantResults(tx,{...row,kind:'AUCTION_WON'})).toBe(0);expect(createMany).not.toHaveBeenCalled();
 });
});
