import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { PrismaClient } from '@prisma/client';
export async function processOneUpdate(client: PrismaClient, bot: Bot) {
  return client.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ updateId: bigint; payload: unknown; attempts: number }>>`
      SELECT "updateId", payload, attempts FROM "BotUpdate"
      WHERE "processedAt" IS NULL AND "nextAttemptAt" <= now() AND attempts < 8
      ORDER BY "updateId" FOR UPDATE SKIP LOCKED LIMIT 1`;
    const row = rows[0]; if (!row) return false;
    try {
      await bot.handleUpdate(row.payload as Update);
      await tx.botUpdate.update({ where: { updateId: row.updateId }, data: { processedAt: new Date(), payload: {}, lastError: null } });
    } catch {
      await tx.botUpdate.update({ where: { updateId: row.updateId }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** (row.attempts + 1)) * 1000), lastError: 'Telegram command delivery failed' } });
    }
    return true;
  }, { timeout: 45000 });
}
