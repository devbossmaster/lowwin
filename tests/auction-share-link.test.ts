import {describe,expect,it} from 'vitest';
import {auctionMiniAppLink,auctionShareLinks,auctionStartPath} from '../src/lib/auction-share-link';
describe('public auction sharing',()=>{
 it('shares the bot Main Mini App destination and descriptive title',()=>{
  const links=auctionShareLinks({botUrl:'https://t.me/LowWinBot?start=lowin',code:'123',title:'Power bank & charger',origin:'https://lowwin.shop'});
  const share=new URL(links.telegram);expect(share.origin+share.pathname).toBe('https://t.me/share/url');expect(share.searchParams.get('url')).toBe('https://t.me/LowWinBot?startapp=auction_123');expect(share.searchParams.get('text')).toBe('Power bank & charger · LowWin');expect(auctionStartPath('auction_123')).toBe('/auctions/123');
 });
 it.each([
  ['winner_5','/winners/5'],['winner_1','/winners/1'],['winner_2147483647','/winners/2147483647'],
  ['auction_2147483647','/auctions/2147483647'],
 ])('routes a validated launch %s to %s',(payload,path)=>expect(auctionStartPath(payload)).toBe(path));
 it.each(['','all','0','01','-5','5.0','2147483648','5/pay','5?pay=1','5#pay','5\n','%35'])('rejects invalid auction and winner codes %j',code=>{
  expect(auctionStartPath('auction_'+code)).toBeNull();
  expect(auctionStartPath('winner_'+code)).toBeNull();
 });
 it.each([null,undefined,'https://evil.invalid','chapa_0f55aaab-2222-4444-8888-123456789012','winner_/../admin','WINNER_5'])('rejects unsupported launch payloads %s',value=>expect(auctionStartPath(value)).toBeNull());
 it.each(['https://evil.invalid/LowWinBot','https://t.me/LowWinBot/app','http://t.me/LowWinBot','https://t.me/LowWinBot?redirect=evil','https://user@t.me/LowWinBot'])('refuses unapproved bot link %s',value=>expect(auctionMiniAppLink(value,'123')).toBeNull());
 it('retains a public website fallback without a configured bot',()=>{
  const links=auctionShareLinks({botUrl:null,code:'123',title:'Fixture',origin:'https://lowwin.shop'});expect(links.launch).toBe('https://lowwin.shop/auctions/123');expect(new URL(links.whatsapp).searchParams.get('text')).toContain(links.website);expect(new URL(links.facebook).searchParams.get('u')).toBe(links.website);
 });
});
