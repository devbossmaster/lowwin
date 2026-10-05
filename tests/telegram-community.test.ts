import {describe,it,expect} from 'vitest';
import {withTelegramCommunity,TELEGRAM_COMMUNITY_FOOTER,TELEGRAM_SUPPORT_URL} from '../src/lib/telegram-community';
describe('Telegram community footer',()=>{
 it('keeps both handles below the content and within the photo caption budget',()=>{
  const message=withTelegramCommunity('🎉'.repeat(1500));
  expect(Array.from(message).length).toBe(1000);
  expect(message.endsWith(`\n\n${TELEGRAM_COMMUNITY_FOOTER}`)).toBe(true);
  expect(message).not.toContain('\uFFFD');
 });
 it('keeps short notification copy intact',()=>expect(withTelegramCommunity('Auction is open')).toBe(`Auction is open\n\n${TELEGRAM_COMMUNITY_FOOTER}`));
 it('uses the direct support chat',()=>expect(TELEGRAM_SUPPORT_URL).toBe('https://t.me/lowwinsupport'));
});
