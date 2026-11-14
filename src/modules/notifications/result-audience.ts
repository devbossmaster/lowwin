import {Prisma} from '@prisma/client';
/** Public auction notices contain no private result/identity evidence. Reach
 * registered users who started this bot privately, respecting explicit opt-out.
 * Missing preferences are not created or silently changed by fan-out. */
const eligibleJoins=()=>Prisma.sql`
 FROM "user" u
 LEFT JOIN "NotificationPreference" n ON n."userId"=u.id
 JOIN "BotChat" c ON c."telegramId"=u."telegramId" AND c."chatId"=u."telegramId" AND c.blocked=false
 LEFT JOIN "StaffMember" s ON s."userId"=u.id`;

export function resultRecipientIds(tx:Prisma.TransactionClient,before:Date,cursor?:string){
 return tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT u.id ${eligibleJoins()} WHERE s."userId" IS NULL AND u.role<>'admin' AND COALESCE(n.telegram,true) AND u."createdAt"<=(${before}::timestamptz AT TIME ZONE 'UTC') AND c."startedAt"<=(${before}::timestamptz AT TIME ZONE 'UTC') ${cursor?Prisma.sql`AND u.id>${cursor}`:Prisma.empty} ORDER BY u.id ASC LIMIT 250`);
}

/** Recheck after fan-out: opting out, blocking or staff reassignment must stop
 * an unsent message without changing publication or settlement. */
export async function hasResultSubscription(tx:Prisma.TransactionClient,userId:string){
 const rows=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT u.id ${eligibleJoins()} WHERE u.id=${userId} AND s."userId" IS NULL AND u.role<>'admin' AND COALESCE(n.telegram,true) AND c."startedAt"<=(clock_timestamp() AT TIME ZONE 'UTC') LIMIT 1`);
 return rows.length===1;
}
