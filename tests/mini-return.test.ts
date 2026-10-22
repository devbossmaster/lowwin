import {describe,it,expect} from 'vitest';
import {miniReturnPath} from '../src/lib/mini-return';
describe('Telegram customer return destinations',()=>{
 it('preserves auction, checkout and private customer links',()=>{
  for(const value of ['/auctions/123?checkout=11111111-1111-4111-a111-111111111111','/auctions/old-slug#bid-review','/my-bids?view=history','/draws?tab=upcoming','/profile/alerts','/wallet?type=payments'])expect(miniReturnPath(value)).toBe(value);
 });
 it.each(['https://evil.example','//evil.example/auctions/1','/\\evil.example','/admin','/api/me','/telegram?next=/admin','/profile/../admin','/auctions/%2F%2Fevil.example','/auctions/1\n',null,undefined])('rejects an external or noncustomer destination %s',value=>expect(miniReturnPath(value)).toBe('/'));
});
