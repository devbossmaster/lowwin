import type {Prisma} from '@prisma/client';
import {customerDepositFailures} from '@/lib/deposit-outcome';
// Older DATE_MISMATCH rows also included missing timestamps; keep those reviewable.
const legacyDefiniteFailures=[...customerDepositFailures].filter(code=>code!=='DATE_MISMATCH');
/** Definitive invalid/used IDs do not become staff work, including legacy rows. */
export function depositAttentionWhere(now:Date):Prisma.TopUpIntentWhereInput{return {provider:{in:['CHECK_ET','VERIFY_ET']},caseState:{not:'ARCHIVED'},OR:[
 {caseState:{in:['ESCALATED','REVERSAL_REVIEW']}},
 {AND:[{OR:[{reasonCode:null},{reasonCode:{notIn:legacyDefiniteFailures}}]}, {OR:[{status:{in:['NEEDS_REVIEW','PROVIDER_OUTAGE']}},{status:{in:['PENDING','VERIFYING']},createdAt:{lt:new Date(now.getTime()-3600000)}}]}]},
]};}
