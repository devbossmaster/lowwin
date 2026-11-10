import {describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {publishResult} from '../src/modules/admin/result-publication';
import {publishSettledResultInTransaction,reviewResult,type ReviewSettlement} from '../src/modules/auctions/result-publication';
import {maskResultPhone,safeResultIdentity} from '../src/modules/auctions/result-identity';

function fixture(options:{rule?:string;fallback?:boolean;cancelled?:boolean}={}){
 const modern=options.rule!=='lowest-unique-v1',cancelled=!!options.cancelled,frequencies=cancelled?[]:[{amount:'1',count:2},{amount:'2',count:options.fallback?3:1}],count=frequencies.reduce((n,g)=>n+g.count,0),decision=cancelled?'MINIMUM_PARTICIPANTS':options.fallback?'FIRST_ACCEPTED_LOWEST':'LOWEST_UNIQUE',winner=cancelled||!modern&&options.fallback?null:{id:'winner-bid',userId:'winner',amount:new Prisma.Decimal(options.fallback?'1':'2'),acceptanceOrder:options.fallback?1n:3n};
 const s={id:'settlement',auctionId:'auction',ruleVersion:options.rule??'lowest-unique-v4',termsVersion:1,cutoff:new Date('2026-01-01T12:00:00Z'),completedAt:new Date('2026-01-01T12:00:01Z'),acceptedCount:count,participantCount:modern?cancelled?0:2:null,acceptanceCutoff:modern?BigInt(count):null,decision:modern?decision:null,outcome:cancelled?'CANCELLED':winner?'WINNER':'NO_WINNER',winnerUserId:winner?.userId??null,winningBidId:winner?.id??null,winningPoints:winner?.amount??null,proof:{}} as ReviewSettlement;
 s.proof={settlementId:s.id,ruleVersion:s.ruleVersion,termsVersion:1,cutoff:s.cutoff.toISOString(),acceptedCount:count,outcome:s.outcome,amountFrequencies:frequencies,winner:winner?{userId:winner.userId,bidId:winner.id,amount:winner.amount.toString(),...(modern?{acceptanceOrder:winner.acceptanceOrder.toString()}:{})}:null,...(modern?{participantCount:s.participantCount,minParticipants:2,acceptanceCutoff:String(count),decision}:{})};
 const row={...s,publication:null,auction:{status:cancelled?'CANCELLED':'CLOSED',publishedAt:new Date('2025-01-01'),isDemo:false,testRunId:null,presentation:{images:[{path:'/assets/product.webp'}]},product:null}};
 const tx={$queryRaw:vi.fn().mockResolvedValue([{now:new Date('2026-01-02')}]),auctionSettlement:{findUnique:vi.fn().mockResolvedValue(row)},resultPublicationPolicy:{findUnique:vi.fn().mockResolvedValue({id:'auto',automaticFrom:new Date('2025-01-01')})},resultPublication:{create:vi.fn().mockResolvedValue({publishedAt:new Date('2026-01-02')})},bid:{groupBy:vi.fn(async(args:{by:string[]})=>args.by[0]==='userId'?cancelled?[]:[{userId:'one'},{userId:'two'}]:frequencies.map(g=>({amount:new Prisma.Decimal(g.amount),_count:{_all:g.count}}))),aggregate:vi.fn().mockResolvedValue({_count:{acceptanceOrder:count},_min:{acceptanceOrder:count?1n:null},_max:{acceptanceOrder:count?BigInt(count):null}}),findFirst:vi.fn().mockResolvedValue(winner)},outbox:{createMany:vi.fn().mockResolvedValue({count:2})},auction:{update:vi.fn()}};
 return {s,tx,row};
}
describe('automatic immutable result publication',()=>{
 it('checks exact lowest unique proof and earliest immutable fallback order',async()=>{
  for(const fallback of [false,true]){const {s,tx}=fixture({fallback});expect((await reviewResult(tx as never,s)).winningFrequency).toBe(fallback?2:1);expect(tx.bid.findFirst.mock.calls[0][0]).toMatchObject({orderBy:[{acceptanceOrder:'asc'},{id:'asc'}],where:{acceptedAt:{lt:s.cutoff},acceptanceOrder:{lte:s.acceptanceCutoff}}})}
 });
 it('preserves v1 no-unique no-winner history and modern zero participant cancellation',async()=>{
  for(const options of [{rule:'lowest-unique-v1',fallback:true},{cancelled:true}]){const {s,tx}=fixture(options);await expect(reviewResult(tx as never,s)).resolves.toBeTruthy()}
 });
 it('rejects altered proof, participant totals and acceptance order',async()=>{
  for(const change of [{acceptedCount:99},{winningBidId:'forged'},{participantCount:3},{acceptanceCutoff:4n},{cutoff:new Date('2026-01-02')}]){const {s,tx}=fixture();await expect(reviewResult(tx as never,{...s,...change})).rejects.toThrow()}
  const {s,tx}=fixture();tx.bid.aggregate.mockResolvedValue({_count:{acceptanceOrder:3},_min:{acceptanceOrder:2n},_max:{acceptanceOrder:3n}});await expect(reviewResult(tx as never,s)).rejects.toMatchObject({code:'ACCEPTANCE_ORDER_MISMATCH'});
 });
 it('creates publication and canonical frozen-media outbox intents together',async()=>{
  const {tx}=fixture();expect(await publishSettledResultInTransaction(tx as never,'auction')).toMatchObject({alreadyPublished:false,historical:false});expect(tx.outbox.createMany.mock.calls[0][0]).toMatchObject({skipDuplicates:true,data:[{key:'settlement:settlement:completed',kind:'AUCTION_FINALIZED',payload:{imagePath:'/assets/product.webp',settlementId:'settlement'}},{key:'settlement:settlement:participants',kind:'AUCTION_PARTICIPANTS'}]});
 });
 it('blocks publication and every announcement intent when the immutable proof does not match',async()=>{
  const {tx,row}=fixture();tx.auctionSettlement.findUnique.mockResolvedValue({...row,acceptedCount:4});
  await expect(publishSettledResultInTransaction(tx as never,'auction')).rejects.toMatchObject({code:'RESULT_PROOF_MISMATCH'});expect(tx.resultPublication.create).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();
 });
 it('checks database wall time and rejects an early immutable settlement timestamp',async()=>{
  const {tx,row}=fixture();tx.auctionSettlement.findUnique.mockResolvedValue({...row,completedAt:new Date('2026-01-01T11:59:00Z')});
  tx.$queryRaw.mockResolvedValue([{now:new Date('2026-01-01T11:59:30Z')}]);await expect(publishSettledResultInTransaction(tx as never,'auction')).rejects.toMatchObject({code:'RESULT_NOT_READY'});expect(tx.outbox.createMany).not.toHaveBeenCalled();
  tx.$queryRaw.mockResolvedValue([{now:new Date('2026-01-01T12:00:01Z')}]);await expect(publishSettledResultInTransaction(tx as never,'auction')).rejects.toMatchObject({code:'PARTICIPANT_PROOF_MISMATCH'});expect(tx.outbox.createMany).not.toHaveBeenCalled();
 });
 it('announces cancellation honestly without a winner participant job',async()=>{const {tx}=fixture({cancelled:true});await publishSettledResultInTransaction(tx as never,'auction');expect(tx.outbox.createMany.mock.calls[0][0].data).toHaveLength(1)});
 it('silently backfills pre-cutover history and fails closed if policy is absent',async()=>{
  const {tx}=fixture();tx.resultPublicationPolicy.findUnique.mockResolvedValue({id:'auto',automaticFrom:new Date('2026-01-03')});expect(await publishSettledResultInTransaction(tx as never,'auction')).toMatchObject({historical:true});expect(tx.outbox.createMany).not.toHaveBeenCalled();
  tx.resultPublicationPolicy.findUnique.mockResolvedValue(null as never);await expect(publishSettledResultInTransaction(tx as never,'auction')).rejects.toMatchObject({code:'PUBLICATION_POLICY_NOT_READY'});
 });
 it('keeps existing publication timestamp and never reannounces',async()=>{
  const {tx,row}=fixture();tx.auctionSettlement.findUnique.mockResolvedValue({...row,publication:{publishedAt:new Date('2025-01-03'),historical:true}} as never);expect(await publishSettledResultInTransaction(tx as never,'auction')).toMatchObject({alreadyPublished:true,publishedAt:'2025-01-03T00:00:00.000Z'});expect(tx.bid.groupBy).not.toHaveBeenCalled();expect(tx.outbox.createMany).not.toHaveBeenCalled();
 });
 it('rejects the removed administrator publish mutation',async()=>{await expect(publishResult()).rejects.toMatchObject({status:410})});
});
describe('public result identity',()=>{
 it('returns actual safe display identity and the existing masked contact',()=>{expect(safeResultIdentity({name:' Abebe  M. ',telegramUsername:'abebe_user'})).toEqual({displayName:'Abebe M.',username:'@abebe_user'});expect(maskResultPhone('+251911652904')).toBe('+251911***904')});
 it('rejects phone and email names, hidden controls and invalid handles',()=>{
  for(const name of ['+251 911 652 904','Call 0911652904','a@example.com','０９１１６５２９０４','091\u200b1652904'])expect(safeResultIdentity({name,telegramUsername:'invalid handle'})).toEqual({displayName:null,username:null});
 });
});
