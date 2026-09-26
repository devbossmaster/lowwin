import { Bot, InlineKeyboard } from 'grammy';
import { getEnv } from '@/lib/env';
export function createBot() {
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 20 } });
  bot.command('start', async ctx => {
    if (ctx.chat.type !== 'private') { await ctx.reply('Open a private chat with Lowin to launch the app.'); return; }
    await ctx.reply('Welcome to Lowin. A little different wins.\n\nThe lowest point bid that nobody else chose wins. Open Lowin to see how it works.', { reply_markup: new InlineKeyboard().webApp('Launch Lowin', env.MINI_APP_URL) });
  });
  bot.command('help', async ctx => { await ctx.reply('The smallest point amount placed exactly once wins. If none is unique, there is no winner.\n\nUp to 100 different amounts per auction. Your largest bid is held, plus any disclosed entry fees. No point transfers or withdrawals.\n\nUse /start to open Lowin.'); });
  return bot;
}
