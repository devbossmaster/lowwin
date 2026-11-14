import {describe,expect,it,vi} from 'vitest';
import type {Outbox} from '@prisma/client';
import {expandParticipantResults} from '../src/modules/notifications/participant-results';
describe('retired duplicate participant result fanout',()=>{
 it.each([{}, {cursor:'old-cursor'}])('acknowledges old work without reading identities or creating private duplicates %j',async payload=>{
  const tx={auctionSettlement:{findFirst:vi.fn()},settlementMovement:{findMany:vi.fn()},outbox:{createMany:vi.fn(),upsert:vi.fn(),update:vi.fn()}};
  expect(await expandParticipantResults(tx as never,{id:'job',payload:{auctionId:'auction',settlementId:'s',...payload}} as unknown as Outbox)).toBe(0);
  expect(tx.outbox.update).toHaveBeenCalledWith({where:{id:'job'},data:{state:'SKIPPED',lastError:'NOTIFICATION_RETIRED'}});
  expect(tx.auctionSettlement.findFirst).not.toHaveBeenCalled();expect(tx.settlementMovement.findMany).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();expect(tx.outbox.upsert).not.toHaveBeenCalled();
 });
});
