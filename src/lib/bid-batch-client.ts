import {centsToEtb,etbToCents} from './money';
import {createsFourConsecutiveAmounts} from '@/modules/auctions/consecutive-bids';
import type {BidReceipt} from '@/modules/auctions/bids';

export type BidBatchLine={position:number;number:string;grossFee:string;discount:string;netFee:string};
export type BidBatchQuote={id:string;quoteHash:string;auctionSlug:string;feeVersion:number;ruleVersion:string;lines:BidBatchLine[];entryCount:number;total:string;totalCents:string;grossTotal:string;discountTotal:string;status:string};
export type BidBatchReceipt={batch:BidBatchQuote;receipts:Array<Pick<BidReceipt,'bid'|'charge'>>;wallet?:{available:string;held:string}};
export type BidFeePreview={entryCount:number;grossTotal:string;discountTotal:string;total:string;totalCents:string};
/** Display only. A validated coupon discounts one entry, never the entire batch.
 * The server quote remains authoritative before any payment is submitted. */
export function previewBidFees(entryCount:number,entryFeePoints:string,discountPoints='0'):BidFeePreview{
 if(!Number.isSafeInteger(entryCount)||entryCount<0||entryCount>100)throw new RangeError('Choose between zero and 100 entries.');
 const fee=etbToCents(entryFeePoints),coupon=etbToCents(discountPoints);
 if(fee<0n||coupon<0n||coupon>fee)throw new RangeError('The discount must fit one submission fee.');
 const gross=fee*BigInt(entryCount),discount=entryCount?coupon:0n,total=gross-discount;
 return {entryCount,grossTotal:centsToEtb(gross),discountTotal:centsToEtb(discount),total:centsToEtb(total),totalCents:String(total)};
}
export type BidDraftRules={minPoints:string;maxPoints:string|null;stepPoints:string;remainingSubmissions:number;ownBids:readonly {amount:string}[]};
export type BidDraftError='precision'|'range'|'duplicate'|'consecutive'|'limit';
export function normalizeBidDraft(value:string):string|null{
 if(!/^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value))return null;
 try{return centsToEtb(etbToCents(value))}catch{return null}
}
/** Validate the complete selection, including accepted amounts, before preview.
 * This is feedback only; the server rechecks the immutable order at settlement. */
export function validateBidDraft(values:readonly string[],rules:BidDraftRules):{numbers:string[];error:BidDraftError|null}{
 const numbers:string[]=[],seen=new Set<string>(),accepted=rules.ownBids.map(b=>etbToCents(b.amount));
 if(values.length>rules.remainingSubmissions)return {numbers:[],error:'limit'};
 for(const raw of values){
  const number=normalizeBidDraft(raw);if(number===null)return {numbers:[],error:'precision'};
  const value=etbToCents(number),min=etbToCents(rules.minPoints),max=rules.maxPoints===null?null:etbToCents(rules.maxPoints),step=etbToCents(rules.stepPoints);
  if(value<min||max!==null&&value>max||step<=0n||(value-min)%step!==0n)return {numbers:[],error:'range'};
  if(seen.has(number)||accepted.includes(value))return {numbers:[],error:'duplicate'};
  if(createsFourConsecutiveAmounts(accepted,value))return {numbers:[],error:'consecutive'};
  seen.add(number);accepted.push(value);numbers.push(number);
 }
 return {numbers,error:null};
}

export type DirectPaymentMethod={slug:string;name:string;minAmountCents?:string;maxAmountCents?:string};
export type DirectPaymentMethods={methods:DirectPaymentMethod[];paymentPhone?:string|null};
export type ChapaDirectBidIntent={key:string;paymentMethod:string;phone:string;purpose:'BID';auctionSlug:string;numbers:string[];feeVersion:number;couponId?:string;approvedTotal:string};
export type ChapaDirectIntent=({key:string;paymentMethod:string;phone:string;purpose:'TOP_UP';amount:string}|{key:string;paymentMethod:string;phone:string;purpose:'BID';batchId:string;quoteHash:string}|ChapaDirectBidIntent);
export {normalizePaymentPhone} from './payment-phone';
