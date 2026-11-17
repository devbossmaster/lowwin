import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {bidAuction,bidUser} from './bid-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction,cancelAuction} from '../src/modules/auctions/settlement';
import {processAuctionRefund} from '../src/modules/wallet/auction-refunds';
import {reconcile} from '../src/modules/wallet/ledger';

const source=process.env.V5_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!source)('audited V5 migration over accepted historical auctions',()=>{
 let db:PrismaClient,sql:Client;
 beforeAll(async()=>{
  const url=new URL(source!);if(url.hostname!=='127.0.0.1'||!url.pathname.endsWith('_test'))throw Error('Isolated loopback DB required');const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();url.pathname='/lowwin_v5_transition_'+randomBytes(5).toString('hex')+'_test';await admin.query(`CREATE DATABASE "${url.pathname.slice(1)}"`);await admin.end();
  sql=new Client({connectionString:url.href});await sql.connect();for(const dir of readdirSync('prisma/migrations').filter(dir=>/^20/.test(dir)&&dir<'202611180001').sort())await sql.query(readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));db=new PrismaClient({datasourceUrl:url.href});
 },60000);
 afterAll(async()=>{await db?.$disconnect();await sql?.end()});
 it('transitions only unsettled policies, keeps receipts and legacy orders, releases holds separately, and preserves completed fallback history',async()=>{
  const bid=(uid:string,slug:string,amount:string)=>submitBid(db,{userId:uid,auctionSlug:slug,amount,feeVersion:1,key:randomUUID()});
  const historic=await bidAuction(db,{ruleVersion:'lowest-unique-v2',fee:5,endDelayMs:900}),h1=await bidUser(db,'100'),h2=await bidUser(db,'100');await bid(h1,historic.slug!,'1');await bid(h2,historic.slug!,'1');await new Promise(r=>setTimeout(r,Math.max(0,historic.endsAt!.getTime()-Date.now()+20)));const completed=await closeAuction(db,historic.id);expect(completed.decision).toBe('FIRST_ACCEPTED_LOWEST');
  const active=[];
  for(const ruleVersion of ['lowest-unique-v1','lowest-unique-v3','lowest-unique-v4']){
   const a=await bidAuction(db,{ruleVersion,fee:7,endDelayMs:60000}),u=await bidUser(db,'100'),receipt=await bid(u,a.slug!,ruleVersion==='lowest-unique-v1'?'2':'2.50');active.push({a,u,receipt});
  }
  const originals=await db.operation.findMany({where:{scope:'BID',userId:{in:active.map(x=>x.u)}},orderBy:{id:'asc'}});
  await sql.query(readFileSync('prisma/migrations/202611180001_unique_refunds_v5/migration.sql','utf8'));
  expect(await db.auctionPolicyTransition.count()).toBe(3);expect(await db.auctionTerms.findUniqueOrThrow({where:{auctionId:historic.id}})).toMatchObject({ruleVersion:'lowest-unique-v2'});expect(await db.auctionSettlement.findUniqueOrThrow({where:{id:completed.id}})).toMatchObject({proof:completed.proof,winningBidId:completed.winningBidId});
  expect(await db.operation.findMany({where:{scope:'BID',userId:{in:active.map(x=>x.u)}},orderBy:{id:'asc'}})).toEqual(originals);
  for(const f of active){
   expect((await db.auctionTerms.findUniqueOrThrow({where:{auctionId:f.a.id}})).ruleVersion).toBe('lowest-unique-v5');
   const settlement=await cancelAuction(db,{auctionId:f.a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Migration fixture cancellation',key:randomUUID()});expect(settlement.ruleVersion).toBe('lowest-unique-v5');
   await processAuctionRefund(db,f.a.id);expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${f.u}:available`}})).balance.toString()).toBe('100');expect((await db.auctionHold.aggregate({where:{auctionId:f.a.id},_sum:{points:true}}))._sum.points?.toString()??'0').toBe('0');
  }
  expect(await reconcile(db)).toEqual([]);
  await expect(db.auctionTerms.update({where:{auctionId:active[0].a.id},data:{ruleVersion:'lowest-unique-v4'}})).rejects.toThrow('Frozen terms');
 });
});
