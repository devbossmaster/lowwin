import {describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {expandParticipantResults} from '../src/modules/notifications/participant-results';
const row:Outbox={id:'job',key:'settlement:s:participants',kind:'AUCTION_PARTICIPANTS',payload:{auctionId:'auction',settlementId:'s'},settlementId:'s',testRunId:null,createdAt:new Date(),sentAt:null,state:'PENDING',attempts:0,nextAttemptAt:new Date(),lastError:null};
function transaction(count:number,published=true){return {auctionSettlement:{findFirst:vi.fn().mockResolvedValue(published?{outcome:'WINNER'}:null)},settlementMovement:{findMany:vi.fn().mockResolvedValue(Array.from({length:count},(_,i)=>({userId:`user-${String(i).padStart(4,'0')}`})))},outbox:{createMany:vi.fn(),upsert:vi.fn(),update:vi.fn()}}}
describe('bounded private result notification fanout',()=>{
 it('expands at most250 participants and persists the next immutable cursor',async()=>{
  const tx=transaction(250);expect(await expandParticipantResults(tx as never,row)).toBe(250);
  expect(tx.settlementMovement.findMany).toHaveBeenCalledWith({where:{settlementId:'s'},select:{userId:true},orderBy:{userId:'asc'},take:250});
  const write=tx.outbox.createMany.mock.calls[0][0];expect(write.skipDuplicates).toBe(true);expect(write.data).toHaveLength(250);expect(write.data[0]).toMatchObject({key:'settlement:s:user:user-0000',kind:'AUCTION_CLOSED',payload:{recipientUserId:'user-0000'}});
  expect(tx.outbox.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{key:'settlement:s:participants:after:user-0249'},create:expect.objectContaining({kind:'AUCTION_PARTICIPANTS',payload:{auctionId:'auction',settlementId:'s',cursor:'user-0249'}}),update:{}}));
 });
 it('resumes after a cursor and keeps the same per-recipient keys on replay',async()=>{
  const tx=transaction(2),cursor={...row,payload:{auctionId:'auction',settlementId:'s',cursor:'before'}};
  await expandParticipantResults(tx as never,cursor);await expandParticipantResults(tx as never,cursor);
  expect(tx.settlementMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{settlementId:'s',userId:{gt:'before'}},take:250}));expect(tx.outbox.createMany.mock.calls[0][0]).toEqual(tx.outbox.createMany.mock.calls[1][0]);expect(tx.outbox.upsert).not.toHaveBeenCalled();
 });
 it('never expands unpublished results or reads participant identities',async()=>{
  const tx=transaction(0,false);expect(await expandParticipantResults(tx as never,row)).toBe(0);expect(tx.settlementMovement.findMany).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();expect(tx.outbox.update).toHaveBeenCalledWith({where:{id:'job'},data:{state:'SKIPPED',lastError:'RESULT_NOT_PUBLISHED'}});
 });
});
