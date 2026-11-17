import {Prisma,type Outbox} from '@prisma/client';
import {centsToEtb,etbToCents} from '@/lib/money';
import {ownDepositBonus} from '../wallet/deposit-bonus';
import {demoBidAllowed} from '../auctions/bids';
import {stagingDemoEnabled} from '../auctions/staging-demo';
import {auctionNotificationImageId,auctionNotificationImagePath} from './campaigns';
import {bidPurchaseNotificationCopy,depositNotificationCopy,winnerNotificationCopy,type AmharicNotificationCopy} from './amharic-copy';

type Tx=Prisma.TransactionClient;
type JsonRecord=Record<string,unknown>;
type Content=AmharicNotificationCopy&{userId:string;kind:string;href:string;imagePath?:string;imageId?:string};
const object=(value:unknown):JsonRecord|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:null;
const text=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=160?value:null;
function cents(value:unknown):bigint|null{try{return typeof value==='string'?etbToCents(value):null}catch{return null}}
const auctionSelect={id:true,publishedAt:true,presentation:true,isDemo:true,isSettlementFixture:true,terms:{select:{ruleVersion:true}},product:{select:{title:true,titleAm:true,images:{orderBy:{sortOrder:'asc' as const},take:1,select:{path:true}}}}} satisfies Prisma.AuctionSelect;
type Auction=Prisma.AuctionGetPayload<{select:typeof auctionSelect}>;
function usableAuction(auction:Auction|null){return !!auction?.publishedAt&&(!auction.isDemo||auction.isSettlementFixture&&(demoBidAllowed()||stagingDemoEnabled()))}
function product(auction:Auction){
 const presentation=object(auction.presentation),title=text(presentation?.titleAm)??auction.product?.titleAm??text(presentation?.title)??auction.product?.title??'';
 const fallback=auction.product?.images[0]?.path;
 return {title,imagePath:auctionNotificationImagePath(auction.presentation,fallback),imageId:auctionNotificationImageId(auction.presentation,fallback)};
}
function receiptContent(userId:string,kind:string,href:string,copy:AmharicNotificationCopy|null,auction?:Auction):Content|null{
 if(!copy)return null;
 const image=auction?product(auction):undefined;
 return {userId,kind,href,...copy,...(image?{imagePath:image.imagePath,imageId:image.imageId}:{})};
}

/** Re-read committed financial proof and ownership. Payloads are locators only. */
export async function privateNotificationContent(tx:Tx,row:Pick<Outbox,'kind'|'payload'>&Partial<Pick<Outbox,'key'>>):Promise<Content|null>{
 if(!['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'].includes(row.kind))return null;
 const payload=object(row.payload),userId=text(payload?.recipientUserId);if(!payload||!userId)return null;
 if(row.kind==='AUCTION_FEE_REFUNDED'){
  const refundId=text(payload.refundId),auctionId=text(payload.auctionId),settlementId=text(payload.settlementId);if(!refundId||!auctionId||!settlementId)return null;
  const [refund]=await tx.$queryRaw<Array<{cash:string;bonus:string;expired:string}>>`SELECT r."cashPoints"::text AS cash,COALESCE((SELECT sum("creditedCents")/100 FROM "DepositBonusRefund" WHERE "refundId"=r.id),0)::text AS bonus,COALESCE((SELECT sum("expiredCents")/100 FROM "DepositBonusRefund" WHERE "refundId"=r.id),0)::text AS expired FROM "AuctionRefund" r JOIN "AuctionSettlement" s ON s.id=r."settlementId" JOIN "Journal" j ON j."operationId"=r."operationId" WHERE r.id=${refundId} AND r."userId"=${userId} AND s.id=${settlementId} AND s."auctionId"=${auctionId} AND s.outcome='CANCELLED' AND r.status='COMPLETED' AND r."completedAt"<=clock_timestamp() AT TIME ZONE 'UTC' AND j.kind='AUCTION_FEE_REFUND'`;
  if(!refund)return null;
  return {userId,kind:row.kind,href:'/transactions',title:'ክፍያ ተመልሷል / Fee refund committed',body:`ጨረታው ተሰርዟል። ወደ ዋሌት የተመለሰ: ${refund.cash} ብር። የተመለሰ ጉርሻ: ${refund.bonus} ብር፤ የመጀመሪያው የማብቂያ ጊዜ ይቀጥላል።\nAuction cancelled. Cash returned: ${refund.cash} ETB. Promotional credit restored: ${refund.bonus} ETB with its original expiry.${new Prisma.Decimal(refund.expired).gt(0)?` Expired promotional value: ${refund.expired} ETB; no cash credit.`:''}`,buttonLabel:'ዝርዝሩን ይመልከቱ / View details'};
 }
 if(row.kind==='DEPOSIT_CREDITED'){
  const checkoutId=text(payload.checkoutId),intentId=text(payload.intentId);
  if(checkoutId){
   const order=await tx.chapaCheckout.findUnique({where:{id:checkoutId},select:{id:true,userId:true,purpose:true,status:true,providerStatus:true,verificationState:true,creditJournalId:true,bidId:true,currency:true,amountCents:true,mode:true,phoneBotId:true,initialization:true}});
   if(!order||order.userId!==userId||order.currency!=='ETB'||order.amountCents<=0n||order.providerStatus!=='SUCCESS'||order.verificationState!=='VERIFIED'||!order.creditJournalId)return null;
   const botId=process.env.TELEGRAM_BOT_TOKEN?.split(':')[0];
   if(!botId||order.phoneBotId!==botId||order.mode!==(process.env.CHAPA_MODE??'test'))return null;
   if(!(order.purpose==='TOP_UP'&&order.status==='CREDITED')&&!(order.purpose==='BID'&&order.status==='NEEDS_REVIEW'&&!order.bidId))return null;
   try{
    const bonus=ownDepositBonus(order),principal=centsToEtb(order.amountCents),copy=depositNotificationCopy({depositAmount:principal,creditedAmount:bonus?.credited?bonus.totalCredit:principal,bonusAmount:bonus?.credited?bonus.amount:undefined});
    if(copy&&order.purpose==='BID')copy.body+='\n\nይህ ጨረታ አልተቀበለም። ክፍያው በዋሌትዎ ተቀምጧል።';
    return receiptContent(userId,row.kind,'/wallet',copy);
   }catch{return null}
  }
  if(!intentId)return null;
  const intent=await tx.topUpIntent.findUnique({where:{id:intentId},select:{userId:true,status:true,points:true,expectedCents:true,journalId:true}});
  if(!intent||intent.userId!==userId||intent.status!=='CREDITED'||!intent.journalId)return null;
  const credited=cents(intent.points.toString());
  if(credited===null||credited<=0n||intent.expectedCents!==null&&intent.expectedCents!==credited)return null;
  return receiptContent(userId,row.kind,'/wallet',depositNotificationCopy({creditedAmount:centsToEtb(credited)}));
 }
 const auctionId=text(payload.auctionId);if(!auctionId)return null;
 if(row.kind==='BID_ACCEPTED'){
  const batchId=text(payload.batchId);
  if(batchId){
   const batch=await tx.bidBatchOrder.findUnique({where:{id:batchId},select:{id:true,userId:true,auctionId:true,status:true,lines:true,totalCents:true,ruleVersion:true,receipt:true}});
   if(!batch||batch.userId!==userId||batch.auctionId!==auctionId||batch.status!=='ACCEPTED'||batch.totalCents<0n)return null;
   const receipt=object(batch.receipt),charge=object(receipt?.charge),lines=Array.isArray(batch.lines)?batch.lines:[],bids=Array.isArray(receipt?.bids)?receipt.bids:[];
   if(!lines.length||lines.length>100||bids.length!==lines.length||cents(charge?.netFeePoints)!==batch.totalCents)return null;
   const numbers:string[]=[],ids:string[]=[];let fee=0n;
   for(let i=0;i<lines.length;i++){
    const line=object(lines[i]),bid=object(bids[i]),number=text(line?.number),id=text(bid?.id),net=cents(line?.netFee),numberCents=cents(number);
    if(!number||!id||net===null||net<0n||numberCents===null||numberCents<=0n||cents(bid?.amount)!==numberCents)return null;
    numbers.push(number);ids.push(id);fee+=net;
   }
   if(fee!==batch.totalCents||new Set(ids).size!==ids.length)return null;
   // One bounded lookup verifies every receipt line; no per-number requests.
   const [accepted,auction]=await Promise.all([
    tx.bid.findMany({where:{id:{in:ids},userId,auctionId},take:100,select:{id:true,amount:true}}),
    tx.auction.findUnique({where:{id:auctionId},select:auctionSelect}),
   ]);
   if(accepted.length!==ids.length||!usableAuction(auction))return null;
   const values=new Map(accepted.map(bid=>[bid.id,cents(bid.amount.toString())]));
   if(ids.some((id,index)=>values.get(id)!==cents(numbers[index])))return null;
   return receiptContent(userId,row.kind,'/my-bids',bidPurchaseNotificationCopy({productTitle:product(auction!).title,numbers,paidFee:centsToEtb(batch.totalCents),ruleVersion:batch.ruleVersion}),auction!);
  }
  const bidId=text(payload.bidId)??/^bid:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):accepted$/i.exec(row.key??'')?.[1];if(!bidId)return null;
  const bid=await tx.bid.findUnique({where:{id:bidId},select:{userId:true,auctionId:true,amount:true,feePoints:true,operation:{select:{userId:true,scope:true,result:true}},auction:{select:auctionSelect}}});
  if(!bid||bid.userId!==userId||bid.auctionId!==auctionId||bid.operation.userId!==userId||bid.operation.scope!=='BID'||!usableAuction(bid.auction))return null;
  const charge=object(object(bid.operation.result)?.charge),fee=charge?.netFeePoints??bid.feePoints.toString();
  if(typeof fee!=='string')return null;
  return receiptContent(userId,row.kind,'/my-bids',bidPurchaseNotificationCopy({productTitle:product(bid.auction).title,numbers:[bid.amount.toString()],paidFee:fee,ruleVersion:bid.auction.terms?.ruleVersion}),bid.auction);
 }
 const settlementId=text(payload.settlementId);if(!settlementId)return null;
 const settlement=await tx.auctionSettlement.findUnique({where:{auctionId},select:{id:true,outcome:true,winnerUserId:true,winningPoints:true,winningBidId:true,completedAt:true,cutoff:true,ruleVersion:true,publication:{select:{publishedAt:true}},auction:{select:auctionSelect},winningBid:{select:{userId:true,auctionId:true,amount:true}}}});
 if(!settlement||settlement.id!==settlementId||settlement.outcome!=='WINNER'||settlement.winnerUserId!==userId||!settlement.winningPoints||!settlement.winningBidId||!settlement.publication||!usableAuction(settlement.auction))return null;
 if(settlement.winningBid?.userId!==userId||settlement.winningBid.auctionId!==auctionId||cents(settlement.winningBid.amount.toString())!==cents(settlement.winningPoints.toString()))return null;
 const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 if(settlement.completedAt>now||settlement.cutoff>now||settlement.publication.publishedAt>now)return null;
 return receiptContent(userId,row.kind,'/winning-bids',winnerNotificationCopy({productTitle:product(settlement.auction).title,chosenNumber:settlement.winningPoints.toString(),ruleVersion:settlement.ruleVersion}),settlement.auction);
}
