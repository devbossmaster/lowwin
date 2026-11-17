import type {PrismaClient} from '@prisma/client';

/** Historical CLI compatibility only. V4's non-refundable fallback policy is
 * retired for active auctions; do not bypass immutable terms or downgrade V5.
 * The additive V5 migration performs an explicit audited unsettled transition. */
export async function adoptSubmissionFee(_client:PrismaClient,_code:string,_fee:string,_apply=false):Promise<never>{
 throw Error('This V4 policy command is retired. Apply the audited lowest-unique-v5 migration; it preserves receipts and adopts unique-only cancellation refunds.');
}
