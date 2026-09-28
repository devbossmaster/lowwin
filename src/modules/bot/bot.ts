import { Bot, InlineKeyboard,InputFile,GrammyError } from 'grammy';
import {resolve} from 'node:path';
import { getEnv } from '@/lib/env';
import {db} from '@/lib/db';
import {isRegisteredTelegramUser} from '../auth/own-contact';
import {WELCOME_CAPTION,START_BIDDING_ACTION,CONTACT_REQUEST_MESSAGE,CONTACT_REPLY_KEYBOARD} from './onboarding-copy';
export function createBot({contactVerified}:{contactVerified?:(telegramId:string)=>Promise<boolean>}={}) {
  const env = getEnv();
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 20 } });
  const botId=env.TELEGRAM_BOT_TOKEN.split(':')[0];
  const isVerified=contactVerified??(telegramId=>isRegisteredTelegramUser(db,telegramId,botId));
  bot.command('start', async ctx => {
    if (ctx.chat.type !== 'private') { await ctx.reply('Open a private chat with Lowwin to launch the app.'); return; }
    if(!ctx.from||ctx.from.is_bot||ctx.from.id!==ctx.chat.id||ctx.message?.forward_origin)return;
    if(!await isVerified(String(ctx.from.id))){await ctx.reply(CONTACT_REQUEST_MESSAGE,{reply_markup:CONTACT_REPLY_KEYBOARD});return}
    const caption=WELCOME_CAPTION;
    const reply_markup=new InlineKeyboard().webApp(START_BIDDING_ACTION,env.MINI_APP_URL);
    try{await ctx.replyWithPhoto(new InputFile(resolve('public/banner1.png')),{caption,reply_markup})}
    catch(error){if(!(error instanceof GrammyError&&error.error_code===400)&&!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;await ctx.reply(caption,{reply_markup})}
  });
  bot.command('help', async ctx => { await ctx.reply('The smallest ETB amount placed exactly once wins. If none is unique, there is no winner.\n\nUp to 100 different amounts per auction. Your largest bid is held, plus any disclosed entry fees. No transfers or withdrawals.\n\nUse /start to open Lowwin.'); });
  return bot;
}
