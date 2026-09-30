import type {Prisma} from '@prisma/client';
/** One predicate for the dashboard and queue: overlapping incidents count once. */
export function depositAttentionWhere(now:Date):Prisma.TopUpIntentWhereInput{return {provider:'CHECK_ET',caseState:{not:'ARCHIVED'},OR:[
 {status:{in:['NEEDS_REVIEW','DUPLICATE_CONFLICT','PROVIDER_OUTAGE']}},
 {caseState:{in:['ESCALATED','REVERSAL_REVIEW']}},
 {status:{in:['PENDING','VERIFYING']},createdAt:{lt:new Date(now.getTime()-3600000)}},
]};}
