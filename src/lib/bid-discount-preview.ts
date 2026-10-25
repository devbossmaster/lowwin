import {etbToCents} from './money';

type Quote={eligible:boolean;feeVersion:number;grossFeePoints:string;discountPoints:string;netFeePoints:string;serverNow:string;coupon:{id:string;percent:number;expiresAt:string}|null};
/** Display validation only; the accepting command always rechecks the reward. */
export function usableBidDiscount<T extends Quote>(quote:T|null,feeVersion:number,grossFee:string,receivedAt:number,now=Date.now()):T|null{
 if(!quote?.eligible||!quote.coupon||quote.feeVersion!==feeVersion)return null;
 try{
  const gross=etbToCents(grossFee),discount=etbToCents(quote.discountPoints),net=etbToCents(quote.netFeePoints);
  const elapsed=Math.max(0,now-receivedAt),remaining=Date.parse(quote.coupon.expiresAt)-Date.parse(quote.serverNow)-elapsed;
  return Number.isFinite(remaining)&&remaining>0&&gross===etbToCents(quote.grossFeePoints)&&discount>0n&&net>=0n&&discount+net===gross?quote:null;
 }catch{return null}
}
