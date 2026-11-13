import { Bot, InlineKeyboard } from 'grammy';
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
  bot.command('help', async ctx => { await ctx.reply(ctx.from?.language_code?.startsWith('am')?
    'አዲስ የv3 ጨረታዎች፦ ዝቅተኛው መጠን 1.00 ብር ነው፤ እስከ ሁለት የአስርዮሽ ቦታዎች ይፈቀዳሉ። 1.01፣ 1.02 እና 1.03 ካቀረቡ 1.04ን ይዝለሉ፤ 1.05 ይፈቀዳል። የቀድሞ v1/v2 ጨረታዎች የድሮ የመጠን ደንቦቻቸውን ይከተላሉ። ቢያንስ ሁለት መስፈርቱን የሚያሟሉ ሰዎች ጨረታቸው መቀበል አለበት። ከሁለት ያነሱ ከሆኑ፣ ወይም ጨረታ ካልቀረበ፣ በመዝጊያ ሰዓቱ ጨረታው ይሰረዛል፤ የመግቢያ ክፍያዎች እና የተያዘው ገንዘብ ሁሉ ይመለሳሉ።\n\nአንድ ጊዜ ብቻ ከቀረቡት መጠኖች ዝቅተኛው ያሸንፋል። ልዩ መጠን ከሌለ ብቻ፣ ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ሰው ያሸንፋል። አሮጌ የv1 ጨረታዎች የቀድሞ ደንባቸውን ይከተላሉ፤ ልዩ መጠን ከሌለ አሸናፊ የላቸውም።\n\nእስከ 100 የተለያዩ መጠኖችን ማቅረብ ይችላሉ። ትልቁ ጨረታዎ ብቻ ይያዛል፤ ለወደፊት ጨረታዎች ተጨማሪ ክፍያ የለም። የቀድሞ ክፍያዎች በደረሰኞቻቸው ይቆያሉ። ከማረጋገጥዎ በፊት የጨረታውን ውሎች ያንብቡ። /start በመጠቀም ይክፈቱ።':
    'New v3 auctions accept amounts from ETB 1.00 with up to two decimals. After three adjacent cent amounts (1.01, 1.02, 1.03), skip the next cent (1.04); 1.05 is allowed. Older v1/v2 auctions keep their original amount rules. New auctions require accepted bids from at least two different eligible people. Fewer than two, including no bids, cancels the auction at its deadline: every entry fee is refunded and all holds released.\n\nThe lowest amount accepted exactly once wins. Only if none is unique, the lowest submitted amount wins for the person whose bid at that amount the database accepted first. Original v1 auctions retain their old no-unique/no-winner rule.\n\nUp to 100 different amounts per person per auction. Only your largest bid amount is held for future bids, with no additional bid fee. Earlier charged fees remain on their original receipts. Read the frozen terms before confirmation. Use /start to open Lowwin.'); });
  return bot;
}
