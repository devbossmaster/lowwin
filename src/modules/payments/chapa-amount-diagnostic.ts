import {centsToEtb} from '@/lib/money';
import type {ChapaEvidence} from './chapa-provider';

/** Read-only diagnostic formatting. These arithmetic fields never authorize a
 * payment or replace exact principal-amount verification. No payer data enters
 * this report, and verification does not establish who bears the provider fee. */
export function chapaAmountDiagnostic(order:{amountCents:bigint;currency:string;serviceFeeCents:bigint|null;initialization:unknown},proof:ChapaEvidence|null=null){
 const saved=order.initialization&&typeof order.initialization==='object'&&!Array.isArray(order.initialization)?Reflect.get(order.initialization,'amountCents'):null;
 const initialization=typeof saved==='string'&&/^(0|[1-9]\d*)$/.test(saved)?saved:null;
 return {
  storedPrincipal:{cents:String(order.amountCents),etb:centsToEtb(order.amountCents),currency:order.currency},
  initializationPrincipal:{cents:initialization,matchesStored:initialization===null?null:initialization===String(order.amountCents)},
  storedServiceFeeCents:order.serviceFeeCents===null?null:String(order.serviceFeeCents),
  provider:proof?{
   principal:{cents:proof.amountCents,etb:centsToEtb(BigInt(proof.amountCents)),currency:proof.currency},
   serviceFee:proof.serviceFeeCents===undefined?null:{cents:proof.serviceFeeCents,etb:centsToEtb(BigInt(proof.serviceFeeCents))},
   principalPlusReportedServiceFee:proof.serviceFeeCents===undefined?null:{cents:String(BigInt(proof.amountCents)+BigInt(proof.serviceFeeCents)),etb:centsToEtb(BigInt(proof.amountCents)+BigInt(proof.serviceFeeCents))},
   feePayer:'not_exposed_by_verification',
  }:null,
 };
}
