import { Bot, InlineKeyboard,InputFile,GrammyError } from 'grammy';
import {resolve} from 'node:path';
import { getEnv } from '@/lib/env';
import {db} from '@/lib/db';
import {isRegisteredTelegramUser} from '../auth/own-contact';
import {recordBotReferralStart} from '../referrals/service';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {centsToEtb} from '@/lib/money';
import {WELCOME_CAPTION,START_BIDDING_ACTION,CONTACT_REQUEST_MESSAGE,CONTACT_REPLY_KEYBOARD,CONTACT_KEYBOARD_REMOVED_MESSAGE} from './onboarding-copy';
export function createBot({contactVerified}:{contactVerified?:(telegramId:string)=>Promise<boolean>}={}) {
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 20 } });
  const botId=env.TELEGRAM_BOT_TOKEN.split(':')[0];
  const isVerified=contactVerified??(telegramId=>isRegisteredTelegramUser(db,telegramId,botId));
  bot.command('start', async ctx => {
    if (ctx.chat.type !== 'private') { await ctx.reply('Open a private chat with Lowwin to launch the app.'); return; }
    if(!ctx.from||ctx.from.is_bot||ctx.from.id!==ctx.chat.id||ctx.message?.forward_origin)return;
    const paymentReturn=chapaReturnStartPath(ctx.match);
    if(ctx.match&&!paymentReturn)await recordBotReferralStart(db,String(ctx.from.id),botId,ctx.match);
    if(!await isVerified(String(ctx.from.id))){await ctx.reply(CONTACT_REQUEST_MESSAGE,{reply_markup:CONTACT_REPLY_KEYBOARD});return}
    if(paymentReturn){
      const am=ctx.from.language_code?.startsWith('am');
      const checkoutId=new URL(paymentReturn,env.MINI_APP_URL).searchParams.get('checkout')!;
      const order=await db.chapaCheckout.findFirst({where:{id:checkoutId,user:{telegramId:String(ctx.from.id)},phoneBotId:botId},select:{purpose:true,status:true,creditJournalId:true,bidId:true,amountCents:true,currency:true,mode:true}});
      const credited=order?.currency==='ETB'&&!!order.creditJournalId&&order.purpose==='TOP_UP'&&order.status==='CREDITED';
      const accepted=order?.currency==='ETB'&&!!order.creditJournalId&&!!order.bidId&&order.purpose==='BID'&&order.status==='BID_ACCEPTED';
      if(credited||accepted){
        const amount=centsToEtb(order!.amountCents);
        const modeLabel=order!.mode==='test'?(am?'ሙከራ (TEST) · ':'TEST · '):'';
        const text=modeLabel+(credited?(am?`${amount} ETB ወደ ዋሌትዎ ገብቷል።`:`${amount} ETB credited to your wallet.`):(am?`የ${amount} ETB ክፍያ ተረጋግጧል። ጨረታዎን ተቀብለናል።`:`${amount} ETB payment confirmed. Your bid was accepted.`));
        await ctx.reply(text,{reply_markup:new InlineKeyboard().webApp(am?'Lowwinን ይክፈቱ':'Open Lowwin',new URL(paymentReturn,env.MINI_APP_URL).href)});
        return;
      }
      // The button carries only an opaque attempt ID. Its owner and payment
      // state are checked by the normal authenticated payment endpoints.
      await ctx.reply(am?'ክፍያዎን ለማረጋገጥ Lowwinን ይክፈቱ። ይህ ማስፈንጠሪያ የክፍያ ስኬትን አያረጋግጥም።':'Open Lowwin to check your payment. This link does not confirm payment success.',{reply_markup:new InlineKeyboard().webApp(am?'ክፍያ ያረጋግጡ':'Check payment',new URL(paymentReturn,env.MINI_APP_URL).href)});
      return;
    }
    await ctx.reply(CONTACT_KEYBOARD_REMOVED_MESSAGE,{reply_markup:{remove_keyboard:true}});
    const caption=WELCOME_CAPTION;
    const reply_markup=new InlineKeyboard().webApp(START_BIDDING_ACTION,env.MINI_APP_URL);
    try{await ctx.replyWithPhoto(new InputFile(resolve('public/banner11.png')),{caption,reply_markup})}
    catch(error){if(!(error instanceof GrammyError&&error.error_code===400)&&!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;await ctx.reply(caption,{reply_markup})}
  });
  bot.command('help', async ctx => { await ctx.reply(ctx.from?.language_code?.startsWith('am')?
    'አዲስ የv3 ጨረታዎች፦ ዝቅተኛው መጠን 1.00 ብር ነው፤ እስከ ሁለት የአስርዮሽ ቦታዎች ይፈቀዳሉ። 1.01፣ 1.02 እና 1.03 ካቀረቡ 1.04ን ይዝለሉ፤ 1.05 ይፈቀዳል። የቀድሞ v1/v2 ጨረታዎች የድሮ የመጠን ደንቦቻቸውን ይከተላሉ። ቢያንስ ሁለት መስፈርቱን የሚያሟሉ ሰዎች ጨረታቸው መቀበል አለበት። ከሁለት ያነሱ ከሆኑ፣ ወይም ጨረታ ካልቀረበ፣ በመዝጊያ ሰዓቱ ጨረታው ይሰረዛል፤ የመግቢያ ክፍያዎች እና የተያዘው ገንዘብ ሁሉ ይመለሳሉ።\n\nአንድ ጊዜ ብቻ ከቀረቡት መጠኖች ዝቅተኛው ያሸንፋል። ልዩ መጠን ከሌለ ብቻ፣ ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ሰው ያሸንፋል። አሮጌ የv1 ጨረታዎች የቀድሞ ደንባቸውን ይከተላሉ፤ ልዩ መጠን ከሌለ አሸናፊ የላቸውም።\n\nእስከ 100 የተለያዩ መጠኖችን ማቅረብ ይችላሉ። ትልቁ ጨረታዎ ብቻ ይያዛል፤ ለወደፊት ጨረታዎች ተጨማሪ ክፍያ የለም። የቀድሞ ክፍያዎች በደረሰኞቻቸው ይቆያሉ። ከማረጋገጥዎ በፊት የጨረታውን ውሎች ያንብቡ። /start በመጠቀም ይክፈቱ።':
    'New v3 auctions accept amounts from ETB 1.00 with up to two decimals. After three adjacent cent amounts (1.01, 1.02, 1.03), skip the next cent (1.04); 1.05 is allowed. Older v1/v2 auctions keep their original amount rules. New auctions require accepted bids from at least two different eligible people. Fewer than two, including no bids, cancels the auction at its deadline: every entry fee is refunded and all holds released.\n\nThe lowest amount accepted exactly once wins. Only if none is unique, the lowest submitted amount wins for the person whose bid at that amount the database accepted first. Original v1 auctions retain their old no-unique/no-winner rule.\n\nUp to 100 different amounts per person per auction. Only your largest bid amount is held for future bids, with no additional bid fee. Earlier charged fees remain on their original receipts. Read the frozen terms before confirmation. Use /start to open Lowwin.'); });
  return bot;
}
