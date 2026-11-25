import {randomBytes,randomUUID} from 'node:crypto';
import {Prisma,type BidBatchOrder,type PrismaClient} from '@prisma/client';
import {centsToEtb} from '../src/lib/money';
import {batchLines,normalizeBatchNumbers,ownBatch,persistBidBatchQuoteInTransaction,validateBatchInTransaction} from '../src/modules/auctions/batch';
import {submitBidInTransaction,type BidInput} from '../src/modules/auctions/bids';
import {encryptPhone,phoneHash} from '../src/modules/auth/own-contact';
import {chapaHash,requireChapa} from '../src/modules/payments/chapa-provider';

/** Simulate records written before coupons were retired. New requests must
 * enter through the production endpoints, which reject these offers. */
export function seedLegacyCouponQuote(db:PrismaClient,userId:string,input:{key:string;auctionSlug:string;numbers:string[];feeVersion:number;couponId:string}){
 const numbers=normalizeBatchNumbers(input.numbers);
 const hash=chapaHash(JSON.stringify({...input,numbers}));
 return db.$transaction(async tx=>{
  const priced=await validateBatchInTransaction(tx,userId,input.auctionSlug,numbers,input.feeVersion,input.couponId);
  return persistBidBatchQuoteInTransaction(tx,userId,input,priced,hash);
 });
}

/** Only for tests of already committed wallet records and historic refunds. */
export function recordLegacyCouponBid(db:PrismaClient,input:BidInput){
 return db.$transaction(tx=>submitBidInTransaction(tx,input,process.env,{recoverExistingCouponPayment:true,qualifyReferral:false}));
}

type LegacySingle={key:string;auctionSlug:string;amount:string;feeVersion:number;couponId:string};
export async function seedLegacyHostedCouponIntent(db:PrismaClient,userId:string,input:LegacySingle){
 const priced=await db.$transaction(tx=>validateBatchInTransaction(tx,userId,input.auctionSlug,[input.amount],input.feeVersion,input.couponId));
 const id=randomUUID(),merchantReference='LW'+randomBytes(9).toString('hex'),health=requireChapa();
 const requestHash=chapaHash(JSON.stringify({key:input.key,purpose:'BID',auctionSlug:input.auctionSlug,amount:new Prisma.Decimal(input.amount).toString(),feeVersion:input.feeVersion,couponId:input.couponId}));
 const contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId}});
 return db.chapaCheckout.create({
  data:{id,userId,key:input.key,purpose:'BID',requestHash,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,
   auctionId:priced.auction.id,auctionSlug:input.auctionSlug,feeVersion:input.feeVersion,bidNumber:input.amount,
   grossFee:centsToEtb(priced.grossCents),discountPoints:centsToEtb(priced.discountCents),couponId:input.couponId,
   phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,merchantReference,amountCents:priced.totalCents,expiresAt:new Date(Date.now()+86400000),
   initialization:{amountCents:String(priced.totalCents),merchantReference,idempotencyKey:`lowwin:${id}`,returnUrl:`${process.env.MINI_APP_URL}/payments/chapa/return?checkout=${id}`,returnUrlVersion:1}},
 });
}

export async function seedLegacyDirectCouponIntent(db:PrismaClient,batch:BidBatchOrder,key:string){
 const id=randomUUID(),merchantReference='LW'+randomBytes(9).toString('hex'),health=requireChapa(),phone='+251911652904';
 const contact=await db.telegramOwnContact.findUniqueOrThrow({where:{userId:batch.userId}});
 const requestHash=chapaHash(JSON.stringify({key,paymentMethod:'telebirr',phone:phoneHash(phone),purpose:'BID',batchId:batch.id,quoteHash:batch.quoteHash}));
 return db.chapaCheckout.create({
  data:{id,key,purpose:'BID',userId:batch.userId,requestHash,mode:health.mode,credentialFingerprint:health.credentialFingerprint!,
   chargeType:'DIRECT',flowVersion:2,batchId:batch.id,paymentMethod:'telebirr',auctionId:batch.auctionId,auctionSlug:batch.auctionSlug,
   feeVersion:batch.feeVersion,bidNumber:batchLines(batch)[0].number,grossFee:centsToEtb(batch.grossCents),
   discountPoints:centsToEtb(batch.discountCents),couponId:batch.couponId,phoneCipher:contact.phoneCipher,phoneBotId:contact.botId,
   payerPhoneCipher:encryptPhone(phone.slice(1),contact.botId),merchantReference,amountCents:batch.totalCents,currency:'ETB',
   expiresAt:new Date(Date.now()+300000),reconcileUntil:new Date(Date.now()+7*86400000),
   initialization:{amountCents:String(batch.totalCents),merchantReference,idempotencyKey:`lowwin-direct:${id}`,paymentMethod:'telebirr',payerPhoneHash:phoneHash(phone),batch:ownBatch(batch)}},
 });
}
