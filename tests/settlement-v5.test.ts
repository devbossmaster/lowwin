import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Prisma,PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bidAuction,bidUser} from './bid-fixtures';
import {verifiedReferralUser,earnedReferralCoupon} from './referral-fixtures';
import {submitBid} from '../src/modules/auctions/bids';
import {closeAuction,cancelAuction,closeAuctionInTransaction} from '../src/modules/auctions/settlement';
import {publishSettledResult} from '../src/modules/auctions/result-publication';
import {processAuctionRefund,auctionRefundProgress} from '../src/modules/wallet/auction-refunds';
import {reconcile} from '../src/modules/wallet/ledger';
import {reconcileDepositBonuses} from '../src/modules/wallet/deposit-bonus-reconcile';
import {readDepositBonusFunds,expireDepositBonusLots} from '../src/modules/wallet/deposit-bonus';
import {createInlineCheckout} from '../src/modules/payments/chapa-inline';
import {verifyChapaCheckout} from '../src/modules/payments/chapa';
import type {ChapaInlineTransport} from '../src/modules/payments/chapa-inline-provider';
import {RULE_V5} from '../src/modules/auctions/rules';
import {quoteBidBatch,createAndPayBidBatchWallet} from '../src/modules/auctions/batch';
import {getPersonalBids} from '../src/modules/profile/personal';
import {readWalletProjection} from '../src/modules/wallet/balance';

const url=process.env.V5_TEST_DATABASE_URL??process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('V5 unique-only cancellation and original-funding refunds',()=>{
 let db:PrismaClient;
 beforeAll(async()=>{const u=new URL(url!);if(u.hostname!=='127.0.0.1'||!u.pathname.endsWith('_test'))throw Error('Isolated test DB only');execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:url!,DIRECT_URL:url!},stdio:'pipe'});db=new PrismaClient({datasourceUrl:url!});await db.referralPolicy.upsert({where:{id:'default'},create:{enabled:true,discountPercent:10,expiryDays:30,updatedBy:'fixture'},update:{enabled:true}})},60000);
 afterAll(async()=>{await db?.$disconnect();await(await import('../src/lib/db')).db.$disconnect()});
 const auction=(fee=10,ms=1500)=>bidAuction(db,{ruleVersion:RULE_V5,fee,endDelayMs:ms});
 const bid=(uid:string,slug:string,amount:string,feeVersion=1,couponId?:string)=>submitBid(db,{userId:uid,auctionSlug:slug,amount,feeVersion,couponId,key:randomUUID()});
 const cash=async(uid:string)=>(await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${uid}:available`}})).balance.toString();
 const due=async(a:{endsAt:Date|null})=>new Promise(resolve=>setTimeout(resolve,Math.max(0,a.endsAt!.getTime()-Date.now()+20)));
 async function drain(id:string){for(let n=0;n<150;n++)if((await processAuctionRefund(db,id)).status==='idle')return;throw Error('Refund queue did not drain')}
 it('cancels all repeated numbers, refunds once across concurrent workers and preserves receipts',async()=>{
  const a=await auction(),users=await Promise.all([bidUser(db,'100'),bidUser(db,'100')]);
  const receipts=await Promise.all(users.map(uid=>bid(uid,a.slug!,'1.50')));await due(a);
  const settlements=await Promise.all([closeAuction(db,a.id),closeAuction(db,a.id)]);expect(new Set(settlements.map(s=>s.id)).size).toBe(1);expect(settlements[0]).toMatchObject({outcome:'CANCELLED',decision:'NO_UNIQUE_BID',reason:'NO_UNIQUE_BID',winningBidId:null,winnerUserId:null});
  expect(await auctionRefundProgress(db,a.id)).toMatchObject({pending:2,completed:0,cash:'0'});
  await Promise.all(Array.from({length:6},()=>processAuctionRefund(db,a.id)));await drain(a.id);await publishSettledResult(db,a.id,{allowFixture:true});await drain(a.id);
  expect(await Promise.all(users.map(cash))).toEqual(['100','100']);expect(await db.operation.count({where:{userId:{in:users},scope:'AUCTION_FEE_REFUND'}})).toBe(2);
  expect(await auctionRefundProgress(db,a.id)).toMatchObject({pending:0,completed:2,cash:'20'});
  for(const r of receipts)expect((await db.operation.findUniqueOrThrow({where:{id:(await db.bid.findUniqueOrThrow({where:{id:r.bid.id}})).operationId}})).result).toEqual(r);
  expect(await reconcile(db)).toEqual([]);
 });
 it('selects only the lowest unique number and never refunds a completed winner auction',async()=>{
  const a=await auction(),u=await bidUser(db),v=await bidUser(db);await bid(u,a.slug!,'1.10');await bid(v,a.slug!,'1.10');const unique=await bid(v,a.slug!,'1.11');await bid(u,a.slug!,'2.00');await due(a);
  const s=await closeAuction(db,a.id);expect(s).toMatchObject({outcome:'WINNER',decision:'LOWEST_UNIQUE',winningBidId:unique.bid.id});await drain(a.id);expect(await auctionRefundProgress(db,a.id)).toMatchObject({cash:'0',bonus:'0'});expect(await reconcile(db)).toEqual([]);
 });
 it('accepts a contiguous 100-number range while preserving the distinct cap and two-decimal validation',async()=>{
  const a=await real(0),u=(await verifiedReferralUser(db,'Contiguous V5 fixture')).id,numbers=Array.from({length:100},(_,i)=>(1+i/100).toFixed(2));
  const receipt=await createAndPayBidBatchWallet(db,u,{key:randomUUID(),auctionSlug:a.slug!,numbers,feeVersion:1,approvedTotal:'0.00'});expect(receipt.kind).toBe('receipt');expect(await db.bid.count({where:{auctionId:a.id,userId:u}})).toBe(100);
  await expect(bid(u,a.slug!,'2.00')).rejects.toMatchObject({code:'CAP_REACHED'});await expect(bid(u,a.slug!,'2.001')).rejects.toThrow();
  const s=await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Contiguous range fixture cancellation',key:randomUUID()});expect(s.proof).toMatchObject({amountPolicy:{currency:'NONE',minimum:'1',step:'0.01',maxDecimalPlaces:2}});expect((s.proof as {amountPolicy:Record<string,unknown>}).amountPolicy).not.toHaveProperty('maxConsecutive');await drain(a.id);expect(await reconcile(db)).toEqual([]);
 });
 it('keeps minimum participants and rejects both premature settlement and late insertion using database time',async()=>{
  const a=await auction(7),u=await bidUser(db,'100');await bid(u,a.slug!,'3.25');await expect(closeAuction(db,a.id)).rejects.toMatchObject({code:'NOT_DUE'});await due(a);await expect(bid(u,a.slug!,'4.00')).rejects.toMatchObject({code:'AUCTION_CLOSED'});
  expect(await closeAuction(db,a.id)).toMatchObject({outcome:'CANCELLED',decision:'MINIMUM_PARTICIPANTS'});await drain(a.id);expect(await cash(u)).toBe('100');
 });
 it('refunds historical fee revisions as actually paid, and rolls a crashed refund transaction back',async()=>{
  const a=await auction(5,4000),u=await bidUser(db,'100');await bid(u,a.slug!,'1.00');
  await db.auctionFeeRevision.create({data:{auctionId:a.id,version:2,feePoints:new Prisma.Decimal(8),reason:'Synthetic revised fee'}});await bid(u,a.slug!,'2.00',2);
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Fixture cancellation',key:randomUUID()});
  const r=await db.auctionRefund.findFirstOrThrow({where:{userId:u}});
  const before=await cash(u);
  const crashing=new Proxy(db,{get(target,key){if(key==='$transaction')return (fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>target.$transaction(async tx=>{await fn(tx);throw Error('crash after refund work before commit')});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
  await expect(processAuctionRefund(crashing,a.id)).rejects.toThrow('crash after refund work');expect(await cash(u)).toBe(before);expect((await db.auctionRefund.findUniqueOrThrow({where:{id:r.id}})).status).toBe('PENDING');
  await drain(a.id);expect(await cash(u)).toBe('100');expect((await db.auctionRefund.findUniqueOrThrow({where:{id:r.id}})).cashPoints.toString()).toBe('13');
 });
 async function topup(){
  const uid=(await verifiedReferralUser(db)).id,p=await db.depositBonusPolicy.upsert({where:{id:'default'},create:{enabled:true,percent:50,minCents:10000n,validityDays:7,version:1},update:{enabled:true,percent:50}}),reference='CH'+randomUUID().replaceAll('-','');let merchant='';
  const proof={status:'success',data:{merchant_reference:'',chapa_reference:reference,amount:10000,currency:'ETB',status:'SUCCESS',payment_method:'telebirr',mode:'test'}};
  const transport={inline:vi.fn(async(p:{merchantReference:string})=>{merchant=p.merchantReference;return {status:'success',data:{auth_type:'USSD',chapa_reference:reference,payment_status:'PENDING',request_id:'req-'+reference}}}),create:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{slug:'telebirr',name:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]})),validate:vi.fn(async()=>({...proof,data:{...proof.data,merchant_reference:merchant,status:'PENDING'}})),lookup:vi.fn(async()=>({...proof,data:{...proof.data,merchant_reference:merchant}}))} as unknown as ChapaInlineTransport;
  const {order}=await createInlineCheckout(db,uid,{key:randomUUID(),purpose:'TOP_UP',flow:'INLINE',paymentMethod:'telebirr',phone:'0911652904',amount:'100.00',approvedDepositBonusVersion:p.version,approvedDepositBonusAmount:'50.00'},undefined,transport);await verifyChapaCheckout(db,order.id,uid,undefined,transport,true);return {uid,order,transport};
 }
 async function real(fee:number){const a=await bidAuction(db,{ruleVersion:RULE_V5,fee,endDelayMs:60000,isDemo:false});await db.product.update({where:{id:a.productId!},data:{isDemo:false}});return a}
 it('refunds mixed cash and coupon-discounted bonus to their original funds with unchanged expiry',async()=>{
  const f=await topup(),coupon=await earnedReferralCoupon(db,f.uid),a=await real(100);const beforeLot=await db.depositBonusLot.findUniqueOrThrow({where:{checkoutId:f.order.id}});
  const receipt=await bid(f.uid,a.slug!,'2.50',1,coupon.coupon.id);expect(receipt.charge).toMatchObject({netFeePoints:'90',bonusUsed:'50.00'});expect(await cash(f.uid)).toBe('60');
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Fixture cancellation',key:randomUUID()});await drain(a.id);
  expect(await cash(f.uid)).toBe('100');expect(await readDepositBonusFunds(db,f.uid)).toMatchObject({bonusAvailable:'50'});expect((await db.depositBonusLot.findUniqueOrThrow({where:{checkoutId:f.order.id}})).expiresAt).toEqual(beforeLot.expiresAt);
  expect(await readWalletProjection(db,f.uid)).toMatchObject({available:'150',cashAvailable:'100',bonusAvailable:'50',bonusExpiresAt:beforeLot.expiresAt.toISOString()});
  expect(await db.depositBonusRefund.aggregate({where:{userId:f.uid},_sum:{creditedCents:true}})).toMatchObject({_sum:{creditedCents:5000n}});expect(await reconcile(db)).toEqual([]);expect(await reconcileDepositBonuses(db)).toEqual([]);
 });
 it('never converts expired promotional fee value into refundable cash',async()=>{
  const f=await topup(),a=await real(70);await bid(f.uid,a.slug!,'1.50');expect(await cash(f.uid)).toBe('80');
  const sql=new Client({connectionString:url!});await sql.connect();await sql.query('BEGIN');try{await sql.query('ALTER TABLE "DepositBonusLot" DISABLE TRIGGER bonus_immutable');await sql.query('UPDATE "DepositBonusLot" SET "expiresAt"=date_trunc(\'milliseconds\',clock_timestamp() AT TIME ZONE \'UTC\'),"createdAt"=date_trunc(\'milliseconds\',clock_timestamp() AT TIME ZONE \'UTC\')-"validityDays"*interval \'1 day\' WHERE "checkoutId"=$1',[f.order.id]);await sql.query('ALTER TABLE "DepositBonusLot" ENABLE TRIGGER bonus_immutable');await sql.query('COMMIT')}catch(e){await sql.query('ROLLBACK');throw e}finally{await sql.end()}
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Fixture cancellation',key:randomUUID()});await drain(a.id);await expireDepositBonusLots(db);
  expect(await cash(f.uid)).toBe('100');expect(await readDepositBonusFunds(db,f.uid)).toMatchObject({bonusAvailable:'0'});expect(await db.depositBonusRefund.aggregate({where:{userId:f.uid},_sum:{expiredCents:true,creditedCents:true}})).toMatchObject({_sum:{expiredCents:5000n,creditedCents:0n}});expect(await reconcile(db)).toEqual([]);expect(await reconcileDepositBonuses(db)).toEqual([]);
  expect(await readWalletProjection(db,f.uid)).toMatchObject({available:'100',cashAvailable:'100',bonusAvailable:'0',bonusExpiresAt:null});
  const own=(await getPersonalBids(db,f.uid)).items.find(row=>row.auction.code===a.publicCode.toString());expect(own?.feeRefunded).toBe('20');expect(own?.refund?.status).toBe('completed');expect(new Prisma.Decimal(own?.refund?.cash??0).toString()).toBe('20');expect(new Prisma.Decimal(own?.refund?.bonus??0).toString()).toBe('0');expect(new Prisma.Decimal(own?.refund?.bonusExpired??0).toString()).toBe('50');
 });
 it('blocks tampered refund funding and fallback proofs, including a non-UTC database session',async()=>{
  const a=await auction(3),u=await bidUser(db,'100'),v=await bidUser(db,'100');await bid(u,a.slug!,'4.25');await bid(v,a.slug!,'4.25');await due(a);
  const s=await db.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Honolulu'");return closeAuctionInTransaction(tx,a.id)});
  expect(s.decision).toBe('NO_UNIQUE_BID');
  await expect(db.$queryRaw`SELECT validate_v5_settlement(jsonb_populate_record(NULL::"AuctionSettlement",to_jsonb(s)||jsonb_build_object('decision','FIRST_ACCEPTED_LOWEST'))) FROM "AuctionSettlement" s WHERE s.id=${s.id}`).rejects.toThrow();
  await expect(db.$queryRaw`SELECT validate_v5_settlement(jsonb_populate_record(NULL::"AuctionSettlement",to_jsonb(s)||jsonb_build_object('proof',s.proof-'winner'))) FROM "AuctionSettlement" s WHERE s.id=${s.id}`).rejects.toThrow('V5 cancellation cannot invent a winner');
  await expect(db.auctionRefund.updateMany({where:{settlementId:s.id,userId:u},data:{cashPoints:new Prisma.Decimal(100)}})).rejects.toThrow('immutable');
  await drain(a.id);expect(await cash(u)).toBe('100');expect(await reconcile(db)).toEqual([]);
 });
 it('creates no refundable value for zero-paid fees and rejects impossible 100-percent referral coupons',async()=>{
  const a=await auction(0),u=await bidUser(db,'100');await bid(u,a.slug!,'9.50');await due(a);const s=await closeAuction(db,a.id);await drain(a.id);expect(await cash(u)).toBe('100');expect(await db.operation.count({where:{userId:u,scope:'AUCTION_FEE_REFUND'}})).toBe(0);expect(await db.auctionRefund.findUniqueOrThrow({where:{settlementId_userId:{settlementId:s.id,userId:u}}})).toMatchObject({operationId:null,status:'COMPLETED'});
  await expect(db.referralPolicy.update({where:{id:'default'},data:{discountPercent:100}})).rejects.toThrow();expect(await reconcile(db)).toEqual([]);
 });
 it('accounts for a late external payment as wallet credit without an accepted-bid refund',async()=>{
  const uid=(await verifiedReferralUser(db)).id,a=await real(10),quote=await quoteBidBatch(db,uid,{key:randomUUID(),auctionSlug:a.slug!,numbers:['1.90'],feeVersion:1});let merchant='';const ref='CH'+randomUUID().replaceAll('-',''),proof=(status:string)=>({status:'success',data:{merchant_reference:merchant,chapa_reference:ref,amount:1000,currency:'ETB',status,payment_method:'telebirr',mode:'test'}});
  const transport={inline:vi.fn(async(p:{merchantReference:string})=>{merchant=p.merchantReference;return {status:'success',data:{auth_type:'USSD',chapa_reference:ref,payment_status:'PENDING',request_id:'req-'+ref}}}),create:vi.fn(),methods:vi.fn(async()=>({status:'success',data:[{slug:'telebirr',name:'telebirr',can_process_payments:true,supported_currencies:{ETB:{default_min:100,default_max:4320000,countries:{ET:{is_enabled:true}}}}}]})),validate:vi.fn(async()=>proof('SUCCESS')),lookup:vi.fn(async()=>proof('SUCCESS'))} as unknown as ChapaInlineTransport;
  const {order}=await createInlineCheckout(db,uid,{key:randomUUID(),purpose:'BID',flow:'INLINE',batchId:quote.id,quoteHash:quote.quoteHash,paymentMethod:'telebirr',phone:'0911652904'},undefined,transport);
  await cancelAuction(db,{auctionId:a.id,actor:{id:'fixture-operator',permission:'auction:cancel'},reason:'Late confirmation scenario',key:randomUUID()});await verifyChapaCheckout(db,order.id,uid,undefined,transport,true);await verifyChapaCheckout(db,order.id,uid,undefined,transport,true);await drain(a.id);
  expect(await cash(uid)).toBe('10');expect(await db.bid.count({where:{auctionId:a.id,userId:uid}})).toBe(0);expect(await db.auctionRefund.count({where:{userId:uid}})).toBe(0);expect(await db.journal.count({where:{operation:{userId:uid},kind:'CHAPA_RECEIPT'}})).toBe(1);expect(await reconcile(db)).toEqual([]);
 });
});
