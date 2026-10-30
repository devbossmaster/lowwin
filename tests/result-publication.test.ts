import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bidAuction,bidUser} from './bid-fixtures';
import {verifiedAdminFixture} from './admin-auth-fixture';
import {verifyFixtureContact} from './contact-fixtures';
import {TEST_TOKEN,signedLaunch} from './helpers';
const url=process.env.RESULT_TEST_DATABASE_URL;
describe.skipIf(!url)('admin-reviewed publication on disposable PostgreSQL',()=>{
 let db:PrismaClient,ops:typeof import('../src/modules/admin/ops'),settlement:typeof import('../src/modules/auctions/settlement'),bids:typeof import('../src/modules/auctions/bids'),results:typeof import('../src/modules/auctions/results'),personal:typeof import('../src/modules/profile/personal'),ledger:typeof import('../src/modules/wallet/ledger'),reviewModule:typeof import('../src/modules/admin/result-publication');
 let activity:typeof import('../src/modules/auctions/activity'),breakdown:typeof import('../src/modules/auctions/result-breakdown');
 let fulfillment:typeof import('../src/app/api/fulfillment/route');
 let playerCookie='',cookie='',actorId='',auction:Awaited<ReturnType<typeof bidAuction>>,winner='',other='',settledId='',input:Record<string,unknown>,beforeFinancial:string;
 const headers=()=>new Headers({cookie,origin:'http://localhost:3000'});
 const financial=async()=>JSON.stringify({settlement:await db.auctionSettlement.findUnique({where:{auctionId:auction.id}}),movements:await db.settlementMovement.findMany({where:{settlementId:settledId},orderBy:{userId:'asc'}}),operations:await db.operation.count(),journals:await db.journal.count(),balances:await db.ledgerAccount.findMany({where:{wallet:{userId:{in:[winner,other]}}},select:{id:true,balance:true},orderBy:{id:'asc'}})},(_,v)=>typeof v==='bigint'?v.toString():v);
 beforeAll(async()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required');
  Object.assign(process.env,{DATABASE_URL:url,DIRECT_URL:url,NODE_ENV:'test',APP_ENV:'local',DEV_POINTS_ENABLED:'true',DEV_IDENTITY_ENABLED:'false',BETTER_AUTH_URL:'http://localhost:3000',MINI_APP_URL:'http://localhost:3000',BETTER_AUTH_SECRET:'fixture-only-secret-at-least-thirty-two-characters',TELEGRAM_BOT_TOKEN:TEST_TOKEN,TELEGRAM_BOT_USERNAME:'lowin_fixture_bot',TELEGRAM_WEBHOOK_SECRET:'fixture-result-webhook-secret-thirty-two',PHONE_CONTACT_KEY_ID:'publication-fixture',PHONE_CONTACT_KEYS:JSON.stringify({'publication-fixture':'e'.repeat(64)}),PHONE_CONTACT_HASH_KEY:'f'.repeat(64),EMAIL_TRANSPORT:'local-sink',EMAIL_SINK_URL:'http://127.0.0.1:1',REFERRAL_REWARDS_SCHEMA_READY:'false',CHAPA_SCHEMA_READY:'false',ARIFPAY_SCHEMA_READY:'false'});
  if(process.env.LOWWIN_TEST_MIGRATIONS_READY!=='1')execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'pipe'});
  db=new PrismaClient();ops=await import('../src/modules/admin/ops');settlement=await import('../src/modules/auctions/settlement');bids=await import('../src/modules/auctions/bids');results=await import('../src/modules/auctions/results');personal=await import('../src/modules/profile/personal');ledger=await import('../src/modules/wallet/ledger');reviewModule=await import('../src/modules/admin/result-publication');activity=await import('../src/modules/auctions/activity');breakdown=await import('../src/modules/auctions/result-breakdown');fulfillment=await import('../src/app/api/fulfillment/route');
  const {handleAuth}=await import('../src/modules/auth/handler'),approved=await verifiedAdminFixture(db,handleAuth,{email:`publication-${randomUUID()}@lowin.test`,password:'Fixture-only-password-12345',origin:'http://localhost:3000'});cookie=approved.cookie;actorId=approved.id;
  auction=await bidAuction(db,{ruleVersion:'lowest-unique-v3',fee:1,isDemo:false,endDelayMs:2000});winner=await bidUser(db);other=await bidUser(db);
  for(const [userId,telegramId] of [[winner,randomInt(7000000000,7900000000)],[other,randomInt(7000000000,7900000000)]] as const){await db.user.update({where:{id:userId},data:{telegramId:String(telegramId)}});await verifyFixtureContact(db,telegramId)}
  const player=await db.user.findUniqueOrThrow({where:{id:winner},select:{telegramId:true}}),login=await handleAuth(new Request('http://localhost:3000/api/auth/telegram/miniapp/signin',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({initData:signedLaunch({user:JSON.stringify({id:Number(player.telegramId),first_name:'Publication winner fixture'})})})}));expect(login.status).toBe(200);playerCookie=login.headers.getSetCookie().find(value=>value.includes('session_token='))!.split(';')[0];
  for(const [userId,amount] of [[winner,'1'],[other,'1'],[winner,'2']] as const)await bids.submitBid(db,{userId,auctionSlug:auction.slug!,amount,key:randomUUID()});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,auction.endsAt!.getTime()-Date.now()+30)));
  const s=await settlement.closeAuction(db,auction.id);settledId=s.id;input={key:randomUUID(),auctionId:auction.id,settlementId:s.id,proofHash:reviewModule.settlementProofHash(s),reviewed:true,confirmation:'PUBLISH',reason:'Accepted bid uniqueness checked'};beforeFinancial=await financial();
 },60000);
 afterAll(async()=>{await db?.$disconnect();const {db:shared}=await import('../src/lib/db');await shared.$disconnect()});
 it('settles funds at the deadline while public, personal and notification results stay pending',async()=>{
  const s=await db.auctionSettlement.findUniqueOrThrow({where:{auctionId:auction.id}});expect(s.winnerUserId).toBe(winner);expect(s.winningPoints?.toString()).toBe('2');
  expect(await db.auctionHold.count({where:{auctionId:auction.id,points:{gt:0}}})).toBe(0);expect(await db.outbox.count({where:{settlementId:s.id}})).toBe(0);
  expect((await results.getPublicResult(db,String(auction.publicCode)))?.result).toBeNull();expect((await personal.getPersonalBids(db,winner)).items.every(row=>row.outcome==='PENDING'&&row.decision===null)).toBe(true);expect((await personal.getPersonalWins(db,winner)).total).toBe(0);expect(await ledger.reconcile(db)).toEqual([]);
  await db.fulfillmentCase.create({data:{auctionId:auction.id,userId:winner}});const hidden=await fulfillment.GET(new Request('http://localhost:3000/api/fulfillment',{headers:{cookie:playerCookie}}));expect(hidden.status).toBe(200);expect(await hidden.json()).toEqual([]);expect((await fulfillment.POST(new Request('http://localhost:3000/api/fulfillment',{method:'POST',headers:{cookie:playerCookie,origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({auctionId:auction.id,action:'claim',name:'Fixture winner',phone:'+251911111111',address:'Isolated fixture address'})}))).status).toBe(404);
  expect((await activity.readAuctionActivity(db,[auction.publicCode]))[0]?.resultReady).toBe(false);expect(await breakdown.getResultBreakdown(db,String(auction.publicCode),breakdown.breakdownQuery.parse({}))).toBeNull();
 });
 it('requires a current admin session and returns immutable bid review evidence',async()=>{
  await expect(ops.opsMutation(db,new Headers(),'resultPublish',input)).rejects.toMatchObject({status:401});
  await expect(ops.opsMutation(db,headers(),'resultPublish',{...input,winnerUserId:other})).rejects.toThrow();
  const review=await ops.opsRead(db,headers(),['results',auction.id],new URLSearchParams());expect(review).toMatchObject({outcome:'WINNER',winningPoints:'2',winningFrequency:1,frequencies:[{amount:'1',count:2},{amount:'2',count:1}],bids:{total:3}});expect(review.bids.items).toHaveLength(3);
  await expect(ops.opsMutation(db,headers(),'resultPublish',{...input,proofHash:'0'.repeat(64)})).rejects.toMatchObject({status:409});expect(await db.resultPublication.count({where:{settlementId:settledId}})).toBe(0);
 });
 it('rolls publication and announcements back together if its audit cannot commit',async()=>{
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_result_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='OPS_RESULTPUBLISH' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER fail_result_publication_audit BEFORE INSERT ON "AdminAudit" FOR EACH ROW EXECUTE FUNCTION fail_result_publication_audit()');
  try{await expect(ops.opsMutation(db,headers(),'resultPublish',input)).rejects.toThrow();expect(await db.resultPublication.count({where:{settlementId:settledId}})).toBe(0);expect(await db.outbox.count({where:{settlementId:settledId}})).toBe(0);expect(await financial()).toBe(beforeFinancial)}finally{await db.$executeRawUnsafe('DROP TRIGGER fail_result_publication_audit ON "AdminAudit"');await db.$executeRawUnsafe('DROP FUNCTION fail_result_publication_audit()')}
 });
 it('serializes concurrent approvals and retries without repeating ledger or result announcements',async()=>{
  const receipts=await Promise.all([ops.opsMutation(db,headers(),'resultPublish',input),ops.opsMutation(db,headers(),'resultPublish',input)]);expect(receipts[0]).toEqual(receipts[1]);
  expect(await db.resultPublication.count({where:{settlementId:settledId}})).toBe(1);expect(await db.adminAudit.count({where:{action:'OPS_RESULTPUBLISH',target:auction.id}})).toBe(1);expect(await db.outbox.count({where:{settlementId:settledId}})).toBe(2);
  expect(await ops.opsMutation(db,headers(),'resultPublish',{...input,key:randomUUID()})).toMatchObject({alreadyPublished:true});expect(await db.outbox.count({where:{settlementId:settledId}})).toBe(2);expect(await financial()).toBe(beforeFinancial);
  expect(await db.notificationInbox.count({where:{key:{startsWith:`settlement:${settledId}:`}}})).toBe(0);const {expandParticipantResults}=await import('../src/modules/notifications/participant-results'),{materializeAlert}=await import('../src/modules/notifications/service'),job=await db.outbox.findFirstOrThrow({where:{settlementId:settledId,kind:'AUCTION_PARTICIPANTS'}});await db.$transaction(async tx=>{await expandParticipantResults(tx,job);await expandParticipantResults(tx,job);for(const row of await tx.outbox.findMany({where:{settlementId:settledId,kind:'AUCTION_CLOSED'}}))await materializeAlert(tx,row)});expect(await db.outbox.count({where:{settlementId:settledId,kind:'AUCTION_CLOSED'}})).toBe(2);expect(await db.notificationInbox.count({where:{key:{startsWith:`settlement:${settledId}:`}}})).toBe(2);
  expect((await results.getPublicResult(db,String(auction.publicCode)))?.result).toMatchObject({outcome:'WINNER',winningPoints:'2'});expect((await personal.getPersonalWins(db,winner)).total).toBe(1);expect((await personal.getPersonalBids(db,winner)).items.some(row=>row.outcome==='WON')).toBe(true);expect(await ledger.reconcile(db)).toEqual([]);
  const visible=await fulfillment.GET(new Request('http://localhost:3000/api/fulfillment',{headers:{cookie:playerCookie}}));expect((await visible.json()).some((row:{auctionId:string})=>row.auctionId===auction.id)).toBe(true);
  expect((await activity.readAuctionActivity(db,[auction.publicCode]))[0]?.resultReady).toBe(true);expect((await breakdown.getResultBreakdown(db,String(auction.publicCode),breakdown.breakdownQuery.parse({})))?.auction.result).toMatchObject({outcome:'WINNER',winningPoints:'2'});
 });
 it('keeps result publication immutable and denies a revoked administrator',async()=>{
  await expect(db.resultPublication.update({where:{settlementId:settledId},data:{reason:'Changed'}})).rejects.toThrow();
  await expect(db.$executeRawUnsafe('TRUNCATE TABLE "ResultPublication"')).rejects.toThrow();
  await db.user.update({where:{id:actorId},data:{role:'member'}});await expect(ops.opsMutation(db,headers(),'resultPublish',{...input,key:randomUUID()})).rejects.toMatchObject({status:401});expect(await financial()).toBe(beforeFinancial);
 });
});
