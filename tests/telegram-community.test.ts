import {describe,it,expect} from 'vitest';
import {withTelegramChannelButton,withTelegramCommunity,TELEGRAM_COMMUNITY_FOOTER,TELEGRAM_SUPPORT_URL} from '../src/lib/telegram-community';
import {telegramCampaignText} from '../src/modules/notifications/service';
describe('Telegram community links and campaign copy',()=>{
 it('keeps the existing action first and adds the welcome channel button below it',()=>{
  const action={text:'Open Lowwin',web_app:{url:'https://lowwin.test/winners/5'}};
  expect(withTelegramChannelButton([[action]])).toEqual({inline_keyboard:[[action],[{text:'ቴለግራም ቻናላችንን ይቀላቀሉ',url:'https://t.me/lowwinet'}]]});
 });
 it('does not append a second button for the same channel',()=>{
  const rows=[[{text:'Support',url:'https://t.me/lowwinsupport'},{text:'Join',url:'https://t.me/LowwinET/'}]];
  expect(withTelegramChannelButton(rows)).toEqual({inline_keyboard:rows});
 });
 it('keeps both handles below the content and within the photo caption budget',()=>{
  const message=withTelegramCommunity('🎉'.repeat(1500));
  expect(Array.from(message).length).toBe(1000);
  expect(message.endsWith(`\n\n${TELEGRAM_COMMUNITY_FOOTER}`)).toBe(true);
  expect(message).not.toContain('\uFFFD');
 });
 it('keeps short notification copy intact',()=>expect(withTelegramCommunity('Auction is open')).toBe(`Auction is open\n\n${TELEGRAM_COMMUNITY_FOOTER}`));
 it('starts owner broadcasts with the personalized message instead of a generic heading',()=>{
  const message=telegramCampaignText('BROADCAST','Lowwin update · የLowwin መረጃ','Bura,\nA new auction is ready.');
  expect(message.startsWith('Bura,\n')).toBe(true);
  expect(message).not.toContain('Lowwin update');
  expect(message).not.toContain('የLowwin መረጃ');
  expect(message).toBe('Bura,\nA new auction is ready.');
  expect(message).not.toContain(TELEGRAM_COMMUNITY_FOOTER);
 });
 it('keeps event headings separated from automatic notification bodies without appending a community footer',()=>expect(telegramCampaignText('AUCTION_PUBLISHED','New auction','Phone')).toBe('New auction\n\nPhone'));
 it('uses the direct support chat',()=>expect(TELEGRAM_SUPPORT_URL).toBe('https://t.me/lowwinsupport'));
});
