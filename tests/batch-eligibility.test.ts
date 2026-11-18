import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {assertPlayerContact} from '../src/modules/auth/own-contact';
import {assertBatchEligibilityInTransaction,quoteBidBatch,validateBatchInTransaction} from '../src/modules/auctions/batch';
import {ChapaError} from '../src/modules/payments/chapa-provider';
import {verifiedReferralUser} from './referral-fixtures';
import {bidAuction} from './bid-fixtures';

const database=process.env.V5_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('fresh batch eligibility on isolated PostgreSQL',()=>{
 let db:PrismaClient,capture:string[]|null=null;
 beforeAll(()=>{const u=new URL(database!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable loopback test database required');execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:database!,DIRECT_URL:database!},stdio:'pipe'});db=new PrismaClient({datasourceUrl:database!,log:[{level:'query',emit:'event'}]});(db as PrismaClient<Prisma.PrismaClientOptions,'query'>).$on('query',event=>capture?.push(event.query))},60000);
 afterAll(async()=>{await db?.$disconnect();await(await import('../src/lib/db')).db.$disconnect()});
 const member=async()=>(await verifiedReferralUser(db,'Isolated eligibility fixture')).id;
 // Retain the original eligibility decision as an independent before/after
 // reference. The new explicit member-role check has its own regression.
 async function previous(tx:Prisma.TransactionClient,userId:string){await assertPlayerContact(tx,userId);if(await tx.staffMember.findUnique({where:{userId}})||(await tx.userRestriction.findUnique({where:{userId}}))?.suspended)throw new ChapaError(403,'BIDDING_RESTRICTED','Bidding is unavailable for this account.')}
 const decision=async(fn:(tx:Prisma.TransactionClient,id:string)=>Promise<void>,id:string)=>db.$transaction(async tx=>{try{await fn(tx,id);return 'ALLOW'}catch(error){return error instanceof ChapaError?error.code:(error as Error).message}});
 async function equivalent(id:string,result:string){expect(await decision(previous,id)).toBe(result);expect(await decision(assertBatchEligibilityInTransaction,id)).toBe(result)}
 it('accepts only the verified matching member and rejects missing users or contacts',async()=>{await equivalent(await member(),'ALLOW');await equivalent(randomUUID(),'CONTACT_REQUIRED');const u=await db.user.create({data:{id:randomUUID(),name:'No contact',telegramId:String(randomInt(8000000000,8900000000))}});await equivalent(u.id,'CONTACT_REQUIRED')});
 it.each(['revoked','different-bot','different-telegram'] as const)('retains %s contact denial',async kind=>{const id=await member();await db.telegramOwnContact.update({where:{userId:id},data:kind==='revoked'?{revokedAt:new Date()}:kind==='different-bot'?{botId:'987654321'}:{telegramId:String(randomInt(8000000000,8900000000))}});await equivalent(id,'CONTACT_REQUIRED')});
 it.each([true,false])('rejects staff membership even when active=%s',async active=>{const id=await member();await db.staffMember.create({data:{userId:id,active,recoveryHashes:[]}});await equivalent(id,'BIDDING_RESTRICTED')});
 it('preserves suspension checks and accepts an explicitly lifted restriction',async()=>{const id=await member();await db.userRestriction.create({data:{userId:id,suspended:true,reason:'Isolated restriction'}});await equivalent(id,'BIDDING_RESTRICTED');await db.userRestriction.update({where:{userId:id},data:{suspended:false}});await equivalent(id,'ALLOW')});
 it('retains the gated no-Telegram local fixture exception and fails closed outside it',async()=>{const id=(await db.user.create({data:{id:randomUUID(),name:'Local preview member'}})).id;await equivalent(id,'ALLOW');const env=process.env.APP_ENV;try{process.env.APP_ENV='production';await equivalent(id,'CONTACT_REQUIRED')}finally{if(env===undefined)delete process.env.APP_ENV;else process.env.APP_ENV=env}});
 it('reads member-role and contact revocation changes freshly inside an existing transaction',async()=>{const role=await member(),contact=await member();await db.$transaction(async tx=>{await assertBatchEligibilityInTransaction(tx,role);await db.user.update({where:{id:role},data:{role:'admin'}});await expect(assertBatchEligibilityInTransaction(tx,role)).rejects.toMatchObject({code:'BIDDING_RESTRICTED'});await assertBatchEligibilityInTransaction(tx,contact);await db.telegramOwnContact.update({where:{userId:contact},data:{revokedAt:new Date()}});await expect(assertBatchEligibilityInTransaction(tx,contact)).rejects.toThrow('CONTACT_REQUIRED')})});
 it('retains real auction bounds, precision, distinct cap and authoritative fee checks',async()=>{const id=await member(),a=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:1,isDemo:false});await db.product.update({where:{id:a.productId!},data:{isDemo:false}});const validate=(numbers:string[],version=1)=>db.$transaction(tx=>validateBatchInTransaction(tx,id,a.slug!,numbers,version));expect((await validate(['1.00','1.01','1.02','1.03'])).lines).toHaveLength(4);await expect(validate(Array.from({length:101},(_,i)=>(1+i/100).toFixed(2)))).rejects.toMatchObject({code:'CAP_REACHED'});await expect(validate(['1.001'])).rejects.toThrow();await expect(validate(['1','1.00'])).rejects.toMatchObject({code:'OWN_DUPLICATE'});await expect(validate(['1.00'],2)).rejects.toMatchObject({code:'TERMS_CHANGED'})});
 it('quotes the newest fee when effective times tie and rejects invisible or missing auctions',async()=>{
  const user=await member(),auction=await bidAuction(db,{ruleVersion:'lowest-unique-v5',fee:1,isDemo:false});
  await db.product.update({where:{id:auction.productId!},data:{isDemo:false}});
  const originalFee=await db.auctionFeeRevision.findUniqueOrThrow({where:{auctionId_version:{auctionId:auction.id,version:1}}});
  await db.auctionFeeRevision.create({data:{auctionId:auction.id,version:2,feePoints:'1.03',effectiveAt:originalFee.effectiveAt,reason:'Same timestamp fixture'}});
  const command={key:randomUUID(),auctionSlug:auction.slug!,numbers:['1.01','2.03'],feeVersion:2};
  await expect(quoteBidBatch(db,user,{...command,feeVersion:1})).rejects.toMatchObject({code:'TERMS_CHANGED'});
  await expect(quoteBidBatch(db,user,command)).resolves.toMatchObject({total:'2.06',lines:[{number:'1.01',netFee:'1.03'},{number:'2.03',netFee:'1.03'}]});
  await db.category.update({where:{id:auction.categoryId!},data:{visible:false}});
  await expect(quoteBidBatch(db,user,{...command,key:randomUUID()})).rejects.toMatchObject({code:'AUCTION_CLOSED'});
  await expect(quoteBidBatch(db,user,{...command,key:randomUUID(),auctionSlug:'missing-fixture-auction'})).rejects.toMatchObject({code:'AUCTION_CLOSED'});
 });
 it('reduces verified-member eligibility to one SQL statement and measures deferred round-trip cost',async()=>{
  const id=await member(),delayMs=20;
  function deferred(tx:Prisma.TransactionClient){return new Proxy(tx,{get(target,key){const value=Reflect.get(target,key);const wrap=(fn:Function,owner:unknown)=>(...args:unknown[])=>new Promise(resolve=>setTimeout(resolve,delayMs)).then(()=>Reflect.apply(fn,owner,args));if(key==='$queryRaw')return wrap(value,target);if(['user','telegramOwnContact','staffMember','userRestriction'].includes(String(key)))return new Proxy(value,{get(owner,method){const fn=Reflect.get(owner,method);return typeof fn==='function'?wrap(fn,owner):fn}});return typeof value==='function'?value.bind(target):value}})}
  async function sample(fn:typeof previous,delayed=false){const queries:string[]=[];const ms=await db.$transaction(async tx=>{capture=queries;const began=performance.now();try{await fn(delayed?deferred(tx):tx,id);return performance.now()-began}finally{capture=null}});return {ms,statements:queries.filter(sql=>!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/.test(sql)).length}}
  const before=await sample(previous),after=await sample(assertBatchEligibilityInTransaction);expect(before.statements).toBeGreaterThanOrEqual(4);expect(after.statements).toBe(1);
  const prior=[],current=[];for(let i=0;i<5;i++){prior.push(await sample(previous,true));current.push(await sample(assertBatchEligibilityInTransaction,true))}
  const percentile=(rows:Array<{ms:number}>,q:number)=>[...rows].sort((a,b)=>a.ms-b.ms)[Math.ceil(rows.length*q)-1].ms;
  const report={at:new Date().toISOString(),scope:'Owned loopback PostgreSQL, real verified member/contact rows; no provider HTTP. Deferred samples add20ms before each Prisma eligibility operation; this models round-trip cost and is not production latency.',n:5,delayPerOperationMs:delayMs,baseline:{statements:before.statements,plainMs:before.ms,p50Ms:percentile(prior,.5),p95Ms:percentile(prior,.95)},joined:{statements:after.statements,plainMs:after.ms,p50Ms:percentile(current,.5),p95Ms:percentile(current,.95)},prior,current};
  console.log('batch-eligibility-timing '+JSON.stringify(report));if(process.env.BATCH_ELIGIBILITY_BENCH_REPORT)writeFileSync(process.env.BATCH_ELIGIBILITY_BENCH_REPORT,JSON.stringify(report,null,2)+'\n');
 });
});
