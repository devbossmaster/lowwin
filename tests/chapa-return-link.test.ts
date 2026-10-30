import {describe,expect,it} from 'vitest';
import {chapaBotReturnLink,chapaMiniAppReturnLink,chapaOriginPath,chapaReturnPath,chapaReturnStartPath} from '../src/lib/chapa-return-link';

const id='0f55aaab-2222-4444-8888-123456789012';

describe('opaque Chapa Telegram return links',()=>{
 it('opens the Main Mini App with only an opaque attempt and retains the bot fallback',()=>{
  const bot='https://t.me/lowwin_fixture_bot?start=lowin';
  const app=chapaMiniAppReturnLink(bot,id)!;
  expect(app).toBe(`https://t.me/lowwin_fixture_bot?startapp=chapa_${id}`);
  expect(chapaReturnStartPath(new URL(app).searchParams.get('startapp'))).toBe(chapaReturnPath(id));
  expect(chapaBotReturnLink(bot,id)).toContain('?start=chapa_');
  for(const bad of ['https://evil.test/bot','https://t.me/lowwin_fixture_bot?startapp=other'])expect(chapaMiniAppReturnLink(bad,id)).toBeNull();
  expect(chapaMiniAppReturnLink(bot,id+'&status=SUCCESS')).toBeNull();
 });
 it('restores a payment surface using only the owned response purpose and auction slug',()=>{
  expect(chapaOriginPath({id,purpose:'TOP_UP',auctionSlug:null})).toBe(`/profile?topup=1&chapa=${id}#wallet`);
  expect(chapaOriginPath({id,purpose:'BID',auctionSlug:'original-auction'})).toBe(`/auctions/original-auction?chapa=${id}#bid-review`);
  for(const order of [{id:'not-an-id',purpose:'TOP_UP',auctionSlug:null},{id,purpose:'OTHER',auctionSlug:null},{id,purpose:'BID',auctionSlug:null},{id,purpose:'BID',auctionSlug:'../admin'},{id,purpose:'BID',auctionSlug:'https://evil.test'}])expect(chapaOriginPath(order)).toBeNull();
 });
 it('returns directly to the owned canonical numeric auction code without a slug redirect',()=>{
  expect(chapaOriginPath({id,purpose:'BID',auctionSlug:'original-auction',auctionCode:'9001'})).toBe(`/auctions/9001?chapa=${id}#bid-review`);
  expect(chapaOriginPath({id,purpose:'BID',auctionSlug:null,auctionCode:'2147483647'})).toBe(`/auctions/2147483647?chapa=${id}#bid-review`);
  expect(chapaOriginPath({id,purpose:'TOP_UP',auctionSlug:'original-auction',auctionCode:'9001'})).toBe(`/profile?topup=1&chapa=${id}#wallet`);
  for(const order of [{id:'invalid',purpose:'BID'},{id,purpose:'OTHER'}])expect(chapaOriginPath({...order,auctionSlug:'original-auction',auctionCode:'9001'})).toBeNull();
 });
 it('falls back to a validated historical slug when the public code is missing or invalid',()=>{
  for(const auctionCode of [undefined,null,'','0','-1','01','1.5','2147483648','9007199254740992','../admin','https://evil.test','123?status=SUCCESS','1\n']){
   expect(chapaOriginPath({id,purpose:'BID',auctionSlug:'original-auction',auctionCode})).toBe(`/auctions/original-auction?chapa=${id}#bid-review`);
   expect(chapaOriginPath({id,purpose:'BID',auctionSlug:null,auctionCode})).toBeNull();
  }
 });
 it('carries only the validated original attempt ID through the existing bot start flow',()=>{
  const link=chapaBotReturnLink('https://t.me/lowwin_fixture_bot?start=lowin',id)!;
  expect(link).toBe(`https://t.me/lowwin_fixture_bot?start=chapa_${id}`);
  const payload=new URL(link).searchParams.get('start');
  expect(payload!.length).toBeLessThanOrEqual(64);
  expect(chapaReturnStartPath(payload)).toBe(`/payments/chapa/return?checkout=${id}`);
  expect(chapaReturnPath(id.toUpperCase())).toBe(`/payments/chapa/return?checkout=${id}`);
 });
 it.each([null,undefined,'','chapa_','chapa_invalid',`chapa_${id}&status=SUCCESS`,`chapa_${id}/../admin`,`chapa_${id} `,`chapa_${id}\n`,`CHAPA_${id}`,`https://evil.test/${id}`])('rejects malformed or augmented start payloads %s',payload=>{
  expect(chapaReturnStartPath(payload)).toBeNull();
 });
 it.each([null,undefined,'','javascript:alert(1)','http://t.me/lowwin_fixture_bot','https://evil.test/lowwin_fixture_bot','https://t.me.evil.test/lowwin_fixture_bot','https://user:pass@t.me/lowwin_fixture_bot','https://t.me:8443/lowwin_fixture_bot','https://t.me/lowwin_fixture_bot?next=/admin','https://t.me/lowwin_fixture_bot?start=a&start=b','https://t.me/lowwin_fixture_bot#other',' https://t.me/lowwin_fixture_bot','https://t.me/not-a-bot','https://t.me/share/url'])('rejects unsafe bot origins or extra link parameters %s',botUrl=>{
  expect(chapaBotReturnLink(botUrl,id)).toBeNull();
 });
 it.each([null,undefined,'invalid',`${id}&amount=1`,`${id}#SUCCESS`])('does not produce a path or bot link from invalid attempt ID %s',value=>{
  expect(chapaReturnPath(value)).toBeNull();expect(chapaBotReturnLink('https://t.me/lowwin_fixture_bot',value)).toBeNull();
 });
});
