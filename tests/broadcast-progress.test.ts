import {describe,expect,it,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {broadcastHistory} from '../src/modules/admin/broadcast-history';

function fixture(changes:Record<string,unknown>={},lastError:string|null=null){
 const root={id:'root',key:'broadcast:fixture',payload:{body:'A fixture update',href:'/auctions/42',buttonLabel:'See the power bank',imageId:'image'},createdAt:new Date('2026-10-30T10:00:00Z'),lastError};
 const progress={id:'root',sent:1155n,pending:0n,skipped:265n,failed:1n,batches:0n,failedBatches:0n,blocked:1n,invalid:0n,exhausted:0n,...changes};
 const query=vi.fn().mockResolvedValueOnce([root]).mockResolvedValueOnce([{count:1n}]).mockResolvedValueOnce([progress]);
 return {client:{$queryRaw:query,auction:{findMany:vi.fn()}} as unknown as PrismaClient,query};
}

describe('admin broadcast delivery progress',()=>{
 it('conserves real recipient counts and explains a blocked failure without exposing recipient data',async()=>{
  const {client,query}=fixture(),data=await broadcastHistory(client,{page:2,q:'fixture'});
  expect(data.items[0]).toMatchObject({sent:1155,pending:0,skipped:265,failed:1,recipientCount:1421,state:'NEEDS_ATTENTION',pendingBatches:0,failureReasons:{blocked:1,invalid:0,exhausted:0,other:0},buttonLabel:'See the power bank',miniAppPath:'/auctions/42'});
  expect(JSON.stringify(data)).not.toMatch(/chatId|telegramId|recipientUserId|lastError/);
  const listing=query.mock.calls[0][0];expect(listing.sql).toContain('LIMIT 25 OFFSET ?');expect(listing.values.at(-1)).toBe(25);
 });
 it('reports pending fan-out before recipient rows exist without inventing a recipient count',async()=>{
  const {client}=fixture({sent:0n,skipped:0n,failed:0n,blocked:0n,batches:1n});
  expect((await broadcastHistory(client,{page:1,q:''})).items[0]).toMatchObject({state:'QUEUED',pending:0,pendingBatches:1,recipientCount:0,canStop:true});
 });
 it('does not label failed expansion as a successful empty broadcast',async()=>{
  const {client}=fixture({sent:0n,skipped:0n,failed:0n,blocked:0n,failedBatches:1n});
  expect((await broadcastHistory(client,{page:1,q:''})).items[0]).toMatchObject({state:'NEEDS_ATTENTION',failedBatches:1,canStop:false});
 });
 it('keeps stopped campaigns stopped and bounds unknown delivery failures to a safe aggregate',async()=>{
  const {client}=fixture({failed:4n,blocked:1n,invalid:1n,exhausted:1n},'CAMPAIGN_STOPPED');
  expect((await broadcastHistory(client,{page:1,q:''})).items[0]).toMatchObject({state:'STOPPED',canStop:false,failureReasons:{blocked:1,invalid:1,exhausted:1,other:1}});
 });
});
