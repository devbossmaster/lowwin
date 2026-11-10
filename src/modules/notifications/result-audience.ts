import {Prisma} from '@prisma/client';
import {contactBotId} from '../auth/own-contact';

/** Only explicit Telegram subscribers with a reachable, private, current-bot
 * contact enter result campaigns. No participant membership is required. */
const eligibleJoins=()=>Prisma.sql`
 FROM "user" u
 JOIN "NotificationPreference" n ON n."userId"=u.id AND n.telegram=true
 JOIN "BotChat" c ON c."telegramId"=u."telegramId" AND c."chatId"=u."telegramId" AND c.blocked=false
 JOIN "TelegramOwnContact" t ON t."userId"=u.id AND t."telegramId"=u."telegramId" AND t."botId"=${contactBotId()} AND t."revokedAt" IS NULL
 LEFT JOIN "StaffMember" s ON s."userId"=u.id`;

export function resultRecipientIds(tx:Prisma.TransactionClient,before:Date,cursor?:string){
 return tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT u.id ${eligibleJoins()} WHERE s."userId" IS NULL AND u.role<>'admin' AND u."createdAt"<=${before} ${cursor?Prisma.sql`AND u.id>${cursor}`:Prisma.empty} ORDER BY u.id ASC LIMIT 250`);
}

/** Recheck after fan-out: unsubscribing, blocking, revocation or a bot change
 * must stop an unsent message without changing publication or settlement. */
export async function hasResultSubscription(tx:Prisma.TransactionClient,userId:string){
 const rows=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT u.id ${eligibleJoins()} WHERE u.id=${userId} AND s."userId" IS NULL AND u.role<>'admin' LIMIT 1`);
 return rows.length===1;
}
