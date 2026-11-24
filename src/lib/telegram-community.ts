import type {InlineKeyboardButton,InlineKeyboardMarkup} from 'grammy/types';

export const TELEGRAM_SUPPORT_URL='https://t.me/lowwinsupport';
export const TELEGRAM_CHANNEL_URL='https://t.me/lowwinet';
export const TELEGRAM_CHANNEL_BUTTON={text:'ቴለግራም ቻናላችንን ይቀላቀሉ',url:TELEGRAM_CHANNEL_URL} as const;
export const TELEGRAM_GROUP_URL='https://t.me/LowWinChat';
export const TELEGRAM_COMMUNITY_FOOTER='📢 ቻናላችን፦ @lowwinet\n👥 ግሩፓችን፦ @LowWinChat';
export function withTelegramChannelButton(rows:InlineKeyboardButton[][]):InlineKeyboardMarkup{
 const hasChannel=rows.some(row=>row.some(button=>'url' in button&&button.url.toLowerCase().replace(/\/$/,'')===TELEGRAM_CHANNEL_URL));
 return {inline_keyboard:hasChannel?rows:[...rows,[TELEGRAM_CHANNEL_BUTTON]]};
}
/** Reserve the Telegram photo caption budget for the community links. */
export function withTelegramCommunity(message:string,limit=1000){
 return `${Array.from(message).slice(0,Math.max(0,limit-Array.from(TELEGRAM_COMMUNITY_FOOTER).length-2)).join('')}\n\n${TELEGRAM_COMMUNITY_FOOTER}`;
}
