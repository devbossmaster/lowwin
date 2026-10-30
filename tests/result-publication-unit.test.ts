import {describe,expect,it,vi} from 'vitest';
import {Prisma,type AuctionSettlement} from '@prisma/client';
import {randomUUID} from 'node:crypto';
vi.mock('../src/modules/notifications/service',()=>({materializeAlert:vi.fn()}));
import {publishResult,resultPublishSchema,reviewResult,settlementProofHash} from '../src/modules/admin/result-publication';
const settlement=()=>({id:randomUUID(),auctionId:randomUUID(),ruleVersion:'lowest-unique-v4',outcome:'WINNER',cutoff:new Date('2026-01-01'),completedAt:new Date('2026-01-02'),acceptedCount:3,acceptanceCutoff:3n,winningPoints:new Prisma.Decimal('2'),winningBidId:'bid-2',winnerUserId:'winner',proof:{winner:{bidId:'bid-2',amount:'2'}}} as unknown as AuctionSettlement);
function transaction(s:AuctionSettlement){return {$queryRaw:vi.fn().mockResolvedValue([{total:2}]),bid:{count:vi.fn(async({where}:{where:{amount?:unknown}})=>where.amount?1:3),groupBy:vi.fn().mockResolvedValue([{amount:new Prisma.Decimal(1),_count:{_all:2}},{amount:new Prisma.Decimal(2),_count:{_all:1}}]),findFirst:vi.fn().mockResolvedValue({id:'bid-2',userId:'winner',amount:new Prisma.Decimal(2)})},auctionSettlement:{findUnique:vi.fn().mockResolvedValue({...s,publication:null,auction:{status:'CLOSED',publishedAt:new Date('2025-01-01'),testRunId:null},movements:[]})},resultPublication:{create:vi.fn().mockResolvedValue({publishedAt:new Date('2026-01-03')})},outbox:{createMany:vi.fn(),findMany:vi.fn().mockResolvedValue([])}}}
describe('reviewed result publication',()=>{
 it('rejects browser winner and amount overrides and requires explicit reviewed confirmation',()=>{
  const s=settlement(),input={key:randomUUID(),auctionId:s.auctionId,settlementId:s.id,proofHash:settlementProofHash(s),reviewed:true,confirmation:'PUBLISH',reason:'Checked accepted bids'};
  expect(resultPublishSchema.safeParse(input).success).toBe(true);
  for(const change of [{winnerUserId:'other'},{winningPoints:'1'},{reviewed:false},{confirmation:'SEND'}])expect(resultPublishSchema.safeParse({...input,...change}).success).toBe(false);
 });
 it('checks numerical uniqueness against accepted bids before publishing',async()=>{
  const s=settlement(),tx=transaction(s);tx.bid.groupBy.mockResolvedValueOnce([{amount:new Prisma.Decimal(1),_count:{_all:2}},{amount:new Prisma.Decimal(2),_count:{_all:1}}]).mockResolvedValueOnce([{amount:new Prisma.Decimal(2),_count:{_all:1}}]);const review=await reviewResult(tx as never,s);
  expect(review.winningFrequency).toBe(1);expect(review.frequencies).toEqual([{amount:'1',count:2},{amount:'2',count:1}]);
  await expect(reviewResult(tx as never,{...s,winningBidId:'forged'})).rejects.toMatchObject({status:409});
  await expect(reviewResult(tx as never,{...s,acceptedCount:4})).rejects.toMatchObject({status:409});
 });
 it('refuses non-owner capability and stale proof without creating publication or outbox',async()=>{
  const s=settlement(),tx=transaction(s),input=resultPublishSchema.parse({key:randomUUID(),auctionId:s.auctionId,settlementId:s.id,proofHash:'0'.repeat(64),reviewed:true,confirmation:'PUBLISH',reason:'Checked accepted bids'});
  await expect(publishResult(tx as never,{id:'staff',role:'AUDITOR',now:new Date('2026-01-04')},input)).rejects.toMatchObject({status:403});
  await expect(publishResult(tx as never,{id:'staff',role:'OWNER',now:new Date('2026-01-04')},input)).rejects.toMatchObject({status:409});
  expect(tx.resultPublication.create).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();
 });
 it('replays a historical publication without reannouncing or recalculating money',async()=>{
  const s=settlement(),tx=transaction(s);tx.auctionSettlement.findUnique.mockResolvedValue({...s,publication:{publishedAt:new Date('2026-01-03'),historical:true},auction:{status:'CLOSED',publishedAt:new Date('2025-01-01'),testRunId:null},movements:[]} as never);
  const input=resultPublishSchema.parse({key:randomUUID(),auctionId:s.auctionId,settlementId:s.id,proofHash:settlementProofHash(s),reviewed:true,confirmation:'PUBLISH',reason:'Historical review'});
  expect(await publishResult(tx as never,{id:'staff',role:'OWNER',now:new Date('2026-01-04')},input)).toMatchObject({alreadyPublished:true});expect(tx.resultPublication.create).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();expect(tx.bid.groupBy).not.toHaveBeenCalled();
 });
});
