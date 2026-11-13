import {centsToEtb,etbToCents} from './money';

/** Presentation only: the server freezes and validates the offer before dispatch. */
export type DepositBonusOffer={configured:boolean;enabled:boolean;percent:number;minAmount:string;maxBonus:string|null;validityDays:number;endsAt:string|null;version:number};
export function depositBonusPreview(amount:string,policy:DepositBonusOffer|null|undefined,now=Date.now()){
 let principal=0n,bonus=0n,minimum=0n,active=false;
 try{
  principal=etbToCents(amount||'0');
  if(principal<0n)throw Error('Invalid amount');
  if(policy){
   minimum=etbToCents(policy.minAmount);
   active=policy.configured&&policy.enabled&&Number.isInteger(policy.percent)&&policy.percent>=10&&policy.percent<=100&&minimum>=0n&&Number.isInteger(policy.validityDays)&&policy.validityDays>0&&(!policy.endsAt||Date.parse(policy.endsAt)>now);
   if(active&&principal>0n&&principal>=minimum){
    bonus=principal*BigInt(policy.percent)/100n;
    if(policy.maxBonus!==null){const cap=etbToCents(policy.maxBonus);if(cap<0n)throw Error('Invalid cap');if(bonus>cap)bonus=cap}
   }
  }
 }catch{active=false;bonus=0n;principal=0n}
 return {active,qualifies:active&&bonus>0n,bonusAmount:centsToEtb(bonus),totalCredit:centsToEtb(principal+bonus),minimum:policy?.minAmount??'0.00'};
}
