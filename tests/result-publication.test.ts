import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bidAuction,bidUser} from './bid-fixtures';
import {contactBotId,encryptPhone,phoneHash} from '../src/modules/auth/own-contact';
const url=process.env.RESULT_TEST_DATABASE_URL;
describe.skipIf(!url)('automatic publication on isolated PostgreSQL',()=>{
 let db:PrismaClient,settlement:typeof import('../src/modules/auctions/settlement'),publication:typeof import('../src/modules/auctions/result-publication'),bids:typeof import('../src/modules/auctions/bids'),results:typeof import('../src/modules/auctions/results'),breakdown:typeof import('../src/modules/auctions/result-breakdown');
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',REFERRAL_REWARDS_SCHEMA_READY:'false',CHAPA_SCHEMA_READY:'false',ARIFPAY_SCHEMA_READY:'false'});
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();settlement=await import('../src/modules/auctions/settlement');publication=await import('../src/modules/auctions/result-publication');bids=await import('../src/modules/auctions/bids');results=await import('../src/modules/auctions/results');breakdown=await import('../src/modules/auctions/result-breakdown');
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 const wait=async(a:{endsAt:Date|null})=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,a.endsAt!.getTime()-Date.now()+20)))};
 async function player(){const id=await bidUser(db),telegramId=String(randomInt(7000000000,7900000000)),phone='+2519'+String(randomInt(10000000,99999999)),botId=contactBotId();await db.user.update({where:{id},data:{telegramId}});await db.telegramOwnContact.create({data:{userId:id,telegramId,botId,phoneCipher:encryptPhone(phone,botId),phoneHash:phoneHash(phone),lastFour:phone.slice(-4),verifiedAt:new Date(),sourceUpdateId:BigInt(randomInt(500000000000,600000000000))}});return id}
 async function populated(fallback=false){
  const first=await player(),second=await player(),auction=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:1,isDemo:false,endDelayMs:900});
  await db.user.update({where:{id:first},data:{name:'Actual Telegram name',telegramUsername:'winner_fixture'}});
  for(const [userId,amount] of (fallback?[[first,'1'],[second,'1'],[first,'2'],[second,'2']]:[[first,'1'],[second,'1'],[first,'2']]))await bids.submitBid(db,{userId,auctionSlug:auction.slug!,amount,feeVersion:1,key:randomUUID()});
  await wait(auction);return {auction,first,second};
 }
 const finance=async()=>JSON.stringify({journals:await db.journal.count(),operations:await db.operation.count(),balances:await db.ledgerAccount.findMany({select:{id:true,balance:true},orderBy:{id:'asc'}})},(_,v)=>typeof v==='bigint'?v.toString():v);
 it('automatically exposes a validated result with real publication time and accurate distinct/unique counts',async()=>{
  const {auction,first}=await populated(),[settled,replayed]=await Promise.all([settlement.closeAuction(db,auction.id),settlement.closeAuction(db,auction.id)]),row=await db.resultPublication.findUniqueOrThrow({where:{settlementId:settled.id}});expect(replayed.id).toBe(settled.id);
  expect(row).toMatchObject({historical:false,actorId:'system:auto-publication'});expect(settled.winnerUserId).toBe(first);expect(settled.winningPoints?.toString()).toBe('2');
  expect(await db.outbox.count({where:{settlementId:settled.id}})).toBe(2);
  const view=await results.getPublicResult(db,String(auction.publicCode));expect(view?.result).toMatchObject({publishedAt:row.publishedAt.toISOString(),winnerDisplay:'Actual Telegram name',winnerUsername:'@winner_fixture',winningPoints:'2'});
  const stats=await breakdown.getResultBreakdown(db,String(auction.publicCode),breakdown.breakdownQuery.parse({}));expect(stats).toMatchObject({totalBids:3,totalPlayers:2,totalAmounts:2,totalUniqueAmounts:1});
  const serialized=JSON.stringify(stats);expect(serialized).not.toMatch(/phoneCipher|telegramId|winnerUserId|proof|acceptanceOrder/);
 });
 it('uses earliest immutable acceptance at the lowest number if no unique number exists',async()=>{
  const {auction,first}=await populated(true),s=await settlement.closeAuction(db,auction.id);expect(s).toMatchObject({decision:'FIRST_ACCEPTED_LOWEST',winnerUserId:first});expect(s.winningPoints?.toString()).toBe('1');expect(await db.resultPublication.findUnique({where:{settlementId:s.id}})).toBeTruthy();
 });
 it('recovers a crash after financial settlement, atomically commits publication/outbox and preserves all money',async()=>{
  const {auction}=await populated(),s=await db.$transaction(tx=>settlement.closeAuctionInTransaction(tx,auction.id));
  expect(await db.resultPublication.findUnique({where:{settlementId:s.id}})).toBeNull();const before=await finance();
  const receipts=await Promise.all([publication.recoverUnpublishedResult(db),publication.publishSettledResult(db,auction.id)]);expect(receipts.some(r=>'settlementId'in r&&r.settlementId===s.id)).toBe(true);
  expect(await db.resultPublication.count({where:{settlementId:s.id}})).toBe(1);expect(await db.outbox.count({where:{settlementId:s.id}})).toBe(2);expect(await finance()).toBe(before);
  const original=await db.resultPublication.findUniqueOrThrow({where:{settlementId:s.id}});await publication.publishSettledResult(db,auction.id);expect((await db.resultPublication.findUniqueOrThrow({where:{settlementId:s.id}})).publishedAt).toEqual(original.publishedAt);expect(await finance()).toBe(before);
 });
 it('rolls result publication back if its notification intents cannot commit',async()=>{
  const {auction}=await populated(),s=await db.$transaction(tx=>settlement.closeAuctionInTransaction(tx,auction.id));const before=await finance();
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_auto_result_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."settlementId"='${s.id}' THEN RAISE EXCEPTION 'isolated outbox fixture failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_auto_result_outbox BEFORE INSERT ON "Outbox" FOR EACH ROW EXECUTE FUNCTION reject_auto_result_outbox()');
  try{await expect(publication.publishSettledResult(db,auction.id)).rejects.toThrow();expect(await db.resultPublication.count({where:{settlementId:s.id}})).toBe(0);expect(await db.outbox.count({where:{settlementId:s.id}})).toBe(0);expect(await finance()).toBe(before)}finally{await db.$executeRawUnsafe('DROP TRIGGER reject_auto_result_outbox ON "Outbox"');await db.$executeRawUnsafe('DROP FUNCTION reject_auto_result_outbox()')}
  await publication.publishSettledResult(db,auction.id);
 });
 it('publishes automatic zero/one participant cancellation with no winner and no invented fee refund',async()=>{
  for(const one of [false,true]){const userId=one?await player():null,auction=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:1,isDemo:false,endDelayMs:500});if(userId)await bids.submitBid(db,{userId,auctionSlug:auction.slug!,amount:'3',feeVersion:1,key:randomUUID()});await wait(auction);const s=await settlement.closeAuction(db,auction.id);expect(s).toMatchObject({outcome:'CANCELLED',decision:'MINIMUM_PARTICIPANTS',winnerUserId:null});expect(s.movements.every(m=>m.refundedFees.isZero())).toBe(true);expect(await db.outbox.count({where:{settlementId:s.id,kind:'AUCTION_FINALIZED'}})).toBe(1);expect(await db.outbox.count({where:{settlementId:s.id,kind:'AUCTION_PARTICIPANTS'}})).toBe(0)}
 });
 it('keeps cutover policy and publication immutable',async()=>{
  await expect(db.resultPublicationPolicy.update({where:{id:'auto'},data:{automaticFrom:new Date()}})).rejects.toThrow();const p=await db.resultPublication.findFirstOrThrow();await expect(db.resultPublication.update({where:{settlementId:p.settlementId},data:{reason:'forged'}})).rejects.toThrow();
 });
 it('revalidates frozen proof before publishing and diagnostics do not starve valid later work',async()=>{
  const bad=await populated(),s=await db.$transaction(tx=>settlement.closeAuctionInTransaction(tx,bad.auction.id)),good=await populated(),g=await db.$transaction(tx=>settlement.closeAuctionInTransaction(tx,good.auction.id));
  // A local fixture trigger injects a publication failure without corrupting any immutable winner/proof.
  await db.$executeRawUnsafe(`CREATE FUNCTION block_one_auto_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."settlementId"='${s.id}' THEN RAISE EXCEPTION 'isolated publication fault'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe('CREATE TRIGGER block_one_auto_result BEFORE INSERT ON "ResultPublication" FOR EACH ROW EXECUTE FUNCTION block_one_auto_result()');
  try{expect(await publication.recoverUnpublishedResult(db)).toMatchObject({status:'publication-retry',auctionId:bad.auction.id,code:'PUBLICATION_RETRY'});expect(await publication.recoverUnpublishedResult(db)).toMatchObject({status:'published',settlementId:g.id});expect(await db.auction.findUnique({where:{id:bad.auction.id}})).toMatchObject({publicationAttempts:1,publicationErrorCode:'PUBLICATION_RETRY'})}finally{await db.$executeRawUnsafe('DROP TRIGGER block_one_auto_result ON "ResultPublication"');await db.$executeRawUnsafe('DROP FUNCTION block_one_auto_result()')}
  await publication.publishSettledResult(db,bad.auction.id);
 });
 it('services a newly due auction while recovering an unpublished result in the same bounded iteration',async()=>{
  const prior=await populated(),s=await db.$transaction(tx=>settlement.closeAuctionInTransaction(tx,prior.auction.id));
  const due=await bidAuction(db,{ruleVersion:'lowest-unique-v4',fee:1,isDemo:false,endDelayMs:150});await wait(due);
  expect(await settlement.processDueAuction(db)).toMatchObject({status:'settled',auctionId:due.id});
  expect(await db.resultPublication.findUnique({where:{settlementId:s.id}})).toBeTruthy();expect(await db.auctionSettlement.findUnique({where:{auctionId:due.id},include:{publication:true}})).toMatchObject({outcome:'CANCELLED',publication:{historical:false}});
 });
});
