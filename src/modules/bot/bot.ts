import { Bot, InlineKeyboard } from 'grammy';
import {botHelp} from '@/content/bot-help';
import { getEnv } from '@/lib/env';
import {db} from '@/lib/db';
import {recordBotReferralStart} from '../referrals/service';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {sendWelcomeBanner} from './welcome-banner';
import {installTelegramRateLimit} from '../notifications/telegram-rate';
export function createBot(_options:{contactVerified?:(telegramId:string)=>Promise<boolean>}={}) {
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 20 } });
  installTelegramRateLimit(bot.api,db,env.TELEGRAM_BOT_TOKEN);
  const botId=env.TELEGRAM_BOT_TOKEN.split(':')[0];

  bot.command('start', async ctx => {
    if (ctx.chat.type !== 'private') { await ctx.reply('Open a private chat with Lowwin to launch the app.'); return; }
    if(!ctx.from||ctx.from.is_bot||ctx.from.id!==ctx.chat.id||ctx.message?.forward_origin)return;
    const paymentReturn=chapaReturnStartPath(ctx.match);
    if(ctx.match&&!paymentReturn)await recordBotReferralStart(db,String(ctx.from.id),botId,ctx.match);
    // Only an opaque attempt id enters the link. Owned APIs, not a bot start
    // parameter, establish payment ownership and confirm financial outcomes.
    const destination=paymentReturn?new URL(paymentReturn,env.MINI_APP_URL).href:env.MINI_APP_URL;
    // The public bot welcome is Amharic by default; account identity and referral
    // attribution remain independent of Telegram's interface language.
    const caption='እንኳን ወደ LowWin በደህና መጡ! ጨረታዎችን ይመልከቱ፣ ለመጫረት ሲዘጋጁ ይግቡ።';
    await sendWelcomeBanner(ctx.api,ctx.chat.id,caption,new InlineKeyboard().webApp('LowWinን ይክፈቱ',destination),'am');
  });
  bot.command('help', async ctx => { await ctx.reply(botHelp[ctx.from?.language_code?.startsWith('am')?'am':'en']); });
  return bot;
}
