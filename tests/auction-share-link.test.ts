import {describe,expect,it} from 'vitest';
import {auctionMiniAppLink,auctionShareLinks,auctionStartPath} from '../src/lib/auction-share-link';
describe('public auction sharing',()=>{
 it('shares the bot Main Mini App destination and descriptive title',()=>{
  const links=auctionShareLinks({botUrl:'https://t.me/LowWinBot?start=lowin',code:'123',title:'Power bank & charger',origin:'https://lowwin.shop'});
  const share=new URL(links.telegram);expect(share.origin+share.pathname).toBe('https://t.me/share/url');expect(share.searchParams.get('url')).toBe('https://t.me/LowWinBot?startapp=auction_123');expect(share.searchParams.get('text')).toBe('Power bank & charger · LowWin');expect(auctionStartPath('auction_123')).toBe('/auctions/123');
 });
 it.each(['auction_all','auction_0','auction_01','auction_2147483648','auction_123/pay','https://evil.invalid','chapa_123','auction_1?pay=1'])('rejects unsafe or non-auction launch %s',value=>expect(auctionStartPath(value)).toBeNull());
 it.each(['https://evil.invalid/LowWinBot','https://t.me/LowWinBot/app','http://t.me/LowWinBot','https://t.me/LowWinBot?redirect=evil','https://user@t.me/LowWinBot'])('refuses unapproved bot link %s',value=>expect(auctionMiniAppLink(value,'123')).toBeNull());
 it('retains a public website fallback without a configured bot',()=>{
  const links=auctionShareLinks({botUrl:null,code:'123',title:'Fixture',origin:'https://lowwin.shop'});expect(links.launch).toBe('https://lowwin.shop/auctions/123');expect(new URL(links.whatsapp).searchParams.get('text')).toContain(links.website);expect(new URL(links.facebook).searchParams.get('u')).toBe(links.website);
 });
});
