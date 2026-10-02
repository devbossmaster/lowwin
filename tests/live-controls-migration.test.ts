import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';

const base=process.env.TEST_DATABASE_URL;
const migration='202609300006_live_controls_and_test_runs';
describe.skipIf(!base)('live controls migration over accepted bids',()=>{
 it('backfills revision references without rewriting receipts or money and restores immutability',async()=>{
  const url=new URL(base!);
  if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Disposable loopback only');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';
  const admin=new Client({connectionString:adminUrl.href});await admin.connect();
  const name=`lowwin_controls_upgrade_${randomBytes(5).toString('hex')}_test`;
  try{await admin.query(`CREATE DATABASE "${name}"`)}finally{await admin.end()}
  url.pathname=`/${name}`;
  const pg=new Client({connectionString:url.href});await pg.connect();
  try{
   await pg.query("SET TIME ZONE 'UTC'");
   const dirs=readdirSync('prisma/migrations').filter(x=>/^\d/.test(x)).sort();
   for(const dir of dirs.filter(d=>d<migration))await pg.query(readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
   await pg.query(`BEGIN;
    INSERT INTO "user" (id,name,"updatedAt") VALUES ('upgrade-user','DEMO upgrade fixture',now());
    INSERT INTO "Wallet" (id,"userId") VALUES ('upgrade-wallet','upgrade-user');
    INSERT INTO "LedgerAccount" (id,name,kind,"walletId") VALUES
     ('upgrade-available','user:upgrade-user:available','AVAILABLE','upgrade-wallet'),
     ('upgrade-held','user:upgrade-user:held','HELD','upgrade-wallet'),
     ('upgrade-issuance','platform:issuance','ISSUANCE',NULL),
     ('upgrade-fees','platform:fees','FEES',NULL);
    INSERT INTO "Operation" (id,"userId",scope,key,"requestHash",result) VALUES
     ('upgrade-credit','upgrade-user','DEV_CREDIT','upgrade-credit-key','fixture','{}'),
     ('upgrade-bid-op','upgrade-user','BID','upgrade-bid-key','fixture','{}');
    INSERT INTO "Journal" (id,"operationId",kind,reference) VALUES
     ('upgrade-credit-journal','upgrade-credit','DEV_CREDIT','DEMO upgrade'),
     ('upgrade-bid-journal','upgrade-bid-op','BID','DEMO upgrade bid');
    INSERT INTO "Posting" (id,"journalId","accountId",delta) VALUES
     ('upgrade-credit-in','upgrade-credit-journal','upgrade-available',100),
     ('upgrade-credit-out','upgrade-credit-journal','upgrade-issuance',-100),
     ('upgrade-bid-out','upgrade-bid-journal','upgrade-available',-6),
     ('upgrade-bid-held','upgrade-bid-journal','upgrade-held',4),
     ('upgrade-bid-fee','upgrade-bid-journal','upgrade-fees',2);
    INSERT INTO "Category" (id,slug,name,description) VALUES ('upgrade-category','upgrade-category','Upgrade category','DEMO');
    INSERT INTO "Product" (id,slug,title,description,condition,"categoryId","isDemo") VALUES
     ('upgrade-product','upgrade-product','Upgrade item','DEMO','DEMO','upgrade-category',true);
    INSERT INTO "Auction" (id,code,slug,"productId","categoryId",status,"startsAt","endsAt","isDemo","fulfillmentSummary","fulfillmentRegion") VALUES
     ('upgrade-auction','UPGRADE-001','upgrade-auction','upgrade-product','upgrade-category','DRAFT',now()-interval '1 hour',now()+interval '1 day',true,'DEMO','DEMO');
    INSERT INTO "AuctionTerms" (id,"auctionId","minPoints","maxPoints","stepPoints","entryFeePoints","noWinnerTerms","cancellationTerms","fulfillmentSnapshot") VALUES
     ('upgrade-terms','upgrade-auction',1,100,1,2,'DEMO no winner','DEMO cancellation','DEMO');
    UPDATE "Auction" SET status='LIVE',"publishedAt"=now()-interval '1 hour',"acceptedBidCount"=1 WHERE id='upgrade-auction';
    INSERT INTO "AuctionHold" (id,"walletId","auctionId",points,"updatedAt") VALUES ('upgrade-hold','upgrade-wallet','upgrade-auction',4,now());
    INSERT INTO "Bid" (id,"userId","auctionId",amount,"termsVersion","feePoints","operationId") VALUES
     ('upgrade-bid','upgrade-user','upgrade-auction',4,1,2,'upgrade-bid-op');
    COMMIT;`);
   const snapshot=async()=>{
    const rows=[];
    for(const table of ['Bid','LedgerAccount','Posting','Journal','Operation','AuctionHold'])rows.push((await pg.query(`SELECT (to_jsonb(t)-'feeRevisionId')::text AS value FROM "${table}" t ORDER BY id`)).rows);
    return rows;
   };
   const before=await snapshot();
   const originalTerms=(await pg.query(`SELECT (to_jsonb(t)-ARRAY['publishedEndsAt','maxExtensionMinutes','allowPaidShortening','shortenNoticeMinutes'])::text AS value FROM "AuctionTerms" t ORDER BY id`)).rows;
   await pg.query(readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8'));
   expect(await snapshot()).toEqual(before);
   expect((await pg.query(`SELECT (to_jsonb(t)-ARRAY['publishedEndsAt','maxExtensionMinutes','allowPaidShortening','shortenNoticeMinutes'])::text AS value FROM "AuctionTerms" t ORDER BY id`)).rows).toEqual(originalTerms);
   const linked=await pg.query(`SELECT b.id,r.version,r."feePoints"::text AS fee,t."publishedEndsAt"=a."endsAt" AS deadline FROM "Bid" b JOIN "AuctionFeeRevision" r ON r.id=b."feeRevisionId" JOIN "AuctionTerms" t ON t."auctionId"=b."auctionId" JOIN "Auction" a ON a.id=b."auctionId"`);
   expect(linked.rows).toEqual([{id:'upgrade-bid',version:1,fee:'2',deadline:true}]);
   await expect(pg.query(`UPDATE "Bid" SET amount=5 WHERE id='upgrade-bid'`)).rejects.toThrow('Immutable');
   await expect(pg.query(`UPDATE "AuctionTerms" SET "entryFeePoints"=3 WHERE id='upgrade-terms'`)).rejects.toThrow('Immutable');
   for(const dir of dirs.filter(d=>d>migration))await pg.query(readFileSync(`prisma/migrations/${dir}/migration.sql`,'utf8'));
   expect(await snapshot()).toEqual(before);
  }finally{await pg.query('ROLLBACK').catch(()=>{});await pg.end()}
 },60000);
});
