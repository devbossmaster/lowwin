import type {ChapaCheckout,Prisma,PrismaClient} from '@prisma/client';
import {safeChapaPaymentReason,type ChapaPaymentReasonCode} from '@/lib/chapa-payment-reason';
import type {ChapaEvidence} from './chapa-provider';

type Feedback={reasonCode?:ChapaPaymentReasonCode;cancelledBy?:'USER'|'SYSTEM'};
/** Supplementary display feedback only. The caller must first match private
 * evidence to the owned immutable intent, and commit it with that evidence.
 * Only the exact-body webhook path writes these allowlisted event columns. */
export async function resolvedChapaWebhookReason(client:PrismaClient|Prisma.TransactionClient,order:ChapaCheckout,proof:ChapaEvidence):Promise<Feedback>{
 if(proof.status==='SUCCESS'||proof.status==='PENDING'||!proof.chapaReference)return {};
 // configurationFingerprint scopes delivery deduplication to a signing secret,
 // not payment ownership. Keep valid stored feedback across secret rotation;
 // the immutable checkout/reference/mode plus matched private evidence remain
 // the binding. Only the raw-body-authenticated route writes richer feedback.
 const event=await client.chapaWebhookEvent.findFirst({
  where:{checkoutId:order.id,merchantReference:order.merchantReference,chapaReference:proof.chapaReference,mode:order.mode,event:`payment.${proof.status.toLowerCase()}`,status:{not:'IGNORED'}},
  // A later delivery with an unknown/absent reason must not resurrect an older
  // USER attribution. Resource revision matching below handles reordering.
  orderBy:[{receivedAt:'desc'},{id:'desc'}],
  select:{providerReasonCode:true,cancelledBy:true,providerUpdatedAt:true,paymentMethod:true},
 });
 if(!event||event.paymentMethod&&event.paymentMethod!==(proof.paymentMethod??order.paymentMethod))return {};
 // Do not carry a reason from an older resource revision into a newer private
 // outcome. Missing timestamps remain supplementary for the same reference.
 if(proof.updatedAt&&event.providerUpdatedAt&&event.providerUpdatedAt.getTime()!==proof.updatedAt.getTime())return {};
 const reasonCode=safeChapaPaymentReason(event.providerReasonCode)??undefined;
 const cancelledBy=proof.status==='CANCELLED'&&(event.cancelledBy==='USER'||event.cancelledBy==='SYSTEM')?event.cancelledBy:undefined;
 return {reasonCode,cancelledBy};
}
