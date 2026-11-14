import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {privateNotificationContent} from '../src/modules/notifications/private-content';

const userId='owner',auctionId='auction',bidId='e453b4cb-7860-4411-9009-f537dfb80f8c',secondId='c84b47f4-cd70-4bd7-a90a-2aa2f2b4af25';
const now=new Date('2026-11-14T10:00:00Z'),past=new Date('2026-11-14T09:00:00Z');
const decimal=(value:string)=>new Prisma.Decimal(value);
const auction=()=>({id:auctionId,publishedAt:past,isDemo:false,isSettlementFixture:false,result:null,presentation:{title:'Power bank',titleAm:'የኃይል ባንክ',images:[{path:'/products/bank.webp'}]},terms:{ruleVersion:'lowest-unique-v4'},product:{title:'Power bank',titleAm:'የኃይል ባንክ',images:[{path:'/products/old.webp'}]}});
const deposit=()=>({id:'checkout',userId,purpose:'TOP_UP',status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',creditJournalId:'journal',bidId:null,currency:'ETB',amountCents:10000n,mode:'test',phoneBotId:'123456',initialization:null});
const single=()=>({userId,auctionId,amount:decimal('222.22'),feePoints:decimal('50'),operation:{userId,scope:'BID',result:{charge:{netFeePoints:'35'}}},auction:auction()});
const batch=()=>({id:'batch',userId,auctionId,status:'ACCEPTED',ruleVersion:'lowest-unique-v4',totalCents:7000n,lines:[{number:'1.01',netFee:'35'},{number:'2.02',netFee:'35'}],receipt:{bids:[{id:bidId,amount:'1.01'},{id:secondId,amount:'2.02'}],charge:{netFeePoints:'70'}}});
const winner=()=>({id:'settlement',outcome:'WINNER',winnerUserId:userId,winningPoints:decimal('1.97'),winningBidId:bidId,completedAt:past,cutoff:past,ruleVersion:'lowest-unique-v4',publication:{publishedAt:past},auction:auction(),winningBid:{userId,auctionId,amount:decimal('1.97')}});
function fixture(){return {chapaCheckout:{findUnique:vi.fn().mockResolvedValue(deposit())},topUpIntent:{findUnique:vi.fn().mockResolvedValue({userId,status:'CREDITED',points:decimal('50'),expectedCents:5000n,journalId:'legacy-journal'})},bid:{findUnique:vi.fn().mockResolvedValue(single()),findMany:vi.fn().mockResolvedValue([{id:bidId,amount:decimal('1.01')},{id:secondId,amount:decimal('2.02')}])},bidBatchOrder:{findUnique:vi.fn().mockResolvedValue(batch())},auction:{findUnique:vi.fn().mockResolvedValue(auction())},auctionSettlement:{findUnique:vi.fn().mockResolvedValue(winner())},$queryRaw:vi.fn().mockResolvedValue([{now}])};}
const notification=(kind:string,payload:object,key?:string)=>({kind,payload:payload as Prisma.JsonObject,key});
beforeEach(()=>{vi.stubEnv('TELEGRAM_BOT_TOKEN','123456:test-token');vi.stubEnv('CHAPA_MODE','test')});
afterEach(()=>vi.unstubAllEnvs());

describe('committed private notification facts',()=>{
 it('shows only a verified deposit belonging to its intended owner and bot/environment',async()=>{
  const tx=fixture(),row=notification('DEPOSIT_CREDITED',{checkoutId:'checkout',recipientUserId:userId});
  const content=await privateNotificationContent(tx as never,row);
  expect(content?.body).toContain('100.00 ብር');expect(content?.href).toBe('/wallet');
  expect(tx.chapaCheckout.findUnique).toHaveBeenCalledTimes(1);expect(tx.$queryRaw).not.toHaveBeenCalled();
  for(const patch of [{userId:'other'},{providerStatus:'PENDING'},{verificationState:'UNAVAILABLE'},{creditJournalId:null},{currency:'USD'},{mode:'live'},{phoneBotId:'another'},{status:'BID_ACCEPTED'},{amountCents:0n}]){
   tx.chapaCheckout.findUnique.mockResolvedValueOnce({...deposit(),...patch});expect(await privateNotificationContent(tx as never,row)).toBeNull();
  }
 });
 it('labels the existing committed bonus accurately without another database read',async()=>{
  const tx=fixture();tx.chapaCheckout.findUnique.mockResolvedValue({...deposit(),initialization:{depositBonus:{policyVersion:1,percent:10,minAmountCents:'500',maxBonusCents:null,validityDays:7,endsAt:null,quotedAt:past.toISOString(),amountCents:'1000'}}});
  const content=await privateNotificationContent(tx as never,notification('DEPOSIT_CREDITED',{checkoutId:'checkout',recipientUserId:userId}));
  expect(content?.body).toContain('ያስገቡት: 100.00 ብር');expect(content?.body).toContain('ጉርሻ: 10.00 ብር');expect(content?.body).toContain('በጠቅላላ የገባው: 110.00 ብር');
  expect(tx.$queryRaw).not.toHaveBeenCalled();
 });
 it('does not fabricate a deposit amount from an invalid bonus quote',async()=>{
  const tx=fixture();tx.chapaCheckout.findUnique.mockResolvedValue({...deposit(),initialization:{depositBonus:{amountCents:'9999'}}});
  expect(await privateNotificationContent(tx as never,notification('DEPOSIT_CREDITED',{checkoutId:'checkout',recipientUserId:userId}))).toBeNull();
 });
 it('recognizes verified late payment preservation as a wallet credit, never an accepted bid',async()=>{
  const tx=fixture();tx.chapaCheckout.findUnique.mockResolvedValue({...deposit(),purpose:'BID',status:'NEEDS_REVIEW'});
  const content=await privateNotificationContent(tx as never,notification('DEPOSIT_CREDITED',{checkoutId:'checkout',recipientUserId:userId}));
  expect(content?.href).toBe('/wallet');expect(content?.body).not.toContain('ጨረታዎ ተመዝግቧል');expect(content?.body).toContain('ይህ ጨረታ አልተቀበለም። ክፍያው በዋሌትዎ ተቀምጧል።');
  tx.chapaCheckout.findUnique.mockResolvedValue({...deposit(),purpose:'BID',status:'NEEDS_REVIEW',bidId});
  expect(await privateNotificationContent(tx as never,notification('DEPOSIT_CREDITED',{checkoutId:'checkout',recipientUserId:userId}))).toBeNull();
 });
 it('validates credited legacy intents against their owner, journal and amount',async()=>{
  const tx=fixture(),row=notification('DEPOSIT_CREDITED',{intentId:'intent',recipientUserId:userId});
  expect((await privateNotificationContent(tx as never,row))?.body).toContain('50.00 ብር');
  for(const patch of [{userId:'other'},{status:'PENDING'},{journalId:null},{expectedCents:4900n}]){tx.topUpIntent.findUnique.mockResolvedValueOnce({userId,status:'CREDITED',points:decimal('50'),expectedCents:5000n,journalId:'journal',...patch});expect(await privateNotificationContent(tx as never,row)).toBeNull()}
 });
 it('uses the accepted number and actual discounted fee from the owned operation',async()=>{
  const tx=fixture(),row=notification('BID_ACCEPTED',{bidId,auctionId,recipientUserId:userId});
  const content=await privateNotificationContent(tx as never,row);
  expect(content?.imagePath).toBe('/products/bank.webp');expect(content?.body).toContain('222.22');expect(content?.body).toContain('ክፍያ: 35.00 ብር');
  expect(content?.body).not.toMatch(/50.00|222.22 ብር|unique|reference|rank/i);expect(content?.href).toBe('/my-bids');
  for(const patch of [{userId:'other'},{auctionId:'other'},{operation:{...single().operation,userId:'other'}},{operation:{...single().operation,scope:'TOP_UP'}},{auction:{...auction(),publishedAt:null}}]){tx.bid.findUnique.mockResolvedValueOnce({...single(),...patch});expect(await privateNotificationContent(tx as never,row)).toBeNull()}
 });
 it('supports durable legacy bid keys and legitimate zero-fee coupons',async()=>{
  const tx=fixture();tx.bid.findUnique.mockResolvedValue({...single(),operation:{...single().operation,result:{charge:{netFeePoints:'0'}}}});
  const content=await privateNotificationContent(tx as never,notification('BID_ACCEPTED',{auctionId,recipientUserId:userId},`bid:${bidId}:accepted`));
  expect(content?.body).toContain('ክፍያ: 0.00 ብር');
  expect(await privateNotificationContent(tx as never,notification('BID_ACCEPTED',{auctionId,recipientUserId:userId},'bid:invalid:accepted'))).toBeNull();
 });
 it('prefers product Amharic over an old English snapshot and retains accepted receipts after a result',async()=>{
  const tx=fixture();tx.bid.findUnique.mockResolvedValue({...single(),auction:{...auction(),presentation:{title:'English snapshot'},result:{id:'old-result'}}});
  const content=await privateNotificationContent(tx as never,notification('BID_ACCEPTED',{bidId,auctionId,recipientUserId:userId}));
  expect(content?.body).toContain('የኃይል ባንክ');expect(content?.body).not.toContain('English snapshot');
 });
 it('verifies an entire batch in a single bounded accepted-bid query',async()=>{
  const tx=fixture(),row=notification('BID_ACCEPTED',{batchId:'batch',auctionId,recipientUserId:userId});
  const content=await privateNotificationContent(tx as never,row);
  expect(content?.body).toContain('1.01 · 2.02');expect(content?.body).toContain('ክፍያ: 70.00 ብር');expect(tx.bid.findMany).toHaveBeenCalledTimes(1);
  expect(tx.bid.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:[bidId,secondId]},userId,auctionId},take:100}));
  expect(tx.bid.findUnique).not.toHaveBeenCalled();
 });
 it('rejects batch amount, receipt, membership and owner mismatches',async()=>{
  const tx=fixture(),row=notification('BID_ACCEPTED',{batchId:'batch',auctionId,recipientUserId:userId});
  for(const patch of [{userId:'other'},{auctionId:'other'},{status:'PENDING'},{totalCents:7100n},{receipt:{...batch().receipt,bids:[{id:bidId,amount:'9.99'},{id:secondId,amount:'2.02'}]}}]){tx.bidBatchOrder.findUnique.mockResolvedValueOnce({...batch(),...patch});expect(await privateNotificationContent(tx as never,row)).toBeNull()}
  tx.bid.findMany.mockResolvedValueOnce([{id:bidId,amount:decimal('1.01')}]);expect(await privateNotificationContent(tx as never,row)).toBeNull();
  tx.bid.findMany.mockResolvedValueOnce([{id:bidId,amount:decimal('1.01')},{id:secondId,amount:decimal('9.99')}]);expect(await privateNotificationContent(tx as never,row)).toBeNull();
 });
 it('congratulates only the published winning owner without any other player details',async()=>{
  const tx=fixture(),row=notification('WINNER_CONGRATULATIONS',{auctionId,settlementId:'settlement',recipientUserId:userId});
  const content=await privateNotificationContent(tx as never,row);
  expect(content?.title).toContain('አሸንፈዋል');expect(content?.body).toContain('1.97');expect(content?.href).toBe('/winning-bids');expect(content?.imagePath).toBe('/products/bank.webp');
  expect(content?.body).not.toMatch(/phone|owner|userId|winningBidId|\+251|1.97 ብር/);
  for(const patch of [{id:'other'},{winnerUserId:'other'},{outcome:'NO_WINNER'},{publication:null},{publication:{publishedAt:new Date(now.getTime()+1)}},{winningBid:{...winner().winningBid,userId:'other'}},{winningBid:{...winner().winningBid,amount:decimal('9.99')}}]){tx.auctionSettlement.findUnique.mockResolvedValueOnce({...winner(),...patch});expect(await privateNotificationContent(tx as never,row)).toBeNull()}
 });
 it('does not reinterpret retired kinds, incomplete locators or payload-injected receipt claims',async()=>{
  const tx=fixture();
  for(const row of [notification('AUCTION_WON',{auctionId,recipientUserId:userId}),notification('BID_ACCEPTED',{auctionId,recipientUserId:userId,paid:'999',number:'1'}),notification('DEPOSIT_CREDITED',{checkoutId:'checkout',userId}),notification('WINNER_CONGRATULATIONS',{auctionId,recipientUserId:userId})])expect(await privateNotificationContent(tx as never,row)).toBeNull();
  expect(tx.bid.findUnique).not.toHaveBeenCalled();expect(tx.chapaCheckout.findUnique).not.toHaveBeenCalled();expect(tx.auctionSettlement.findUnique).not.toHaveBeenCalled();
 });
});
