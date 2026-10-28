import {describe,it,expect} from 'vitest';
import {miniReturnPath} from '../src/lib/mini-return';
describe('Telegram customer return destinations',()=>{
 it('preserves auction, checkout and private customer links',()=>{
  for(const value of ['/auctions/123?checkout=11111111-1111-4111-a111-111111111111','/auctions/old-slug#bid-review','/my-bids?view=history','/draws?tab=upcoming','/profile/alerts','/wallet?type=payments'])expect(miniReturnPath(value)).toBe(value);
 });
 it('preserves only the opaque checkout on an owned-payment return through authentication',()=>{
  const path='/payments/chapa/return?checkout=11111111-1111-4111-a111-111111111111';
  expect(miniReturnPath(path)).toBe(path);
  for(const invalid of ['/payments/chapa/return','/payments/chapa/return?checkout=invalid',path+'&status=SUCCESS',path+'&checkout=22222222-2222-4222-a222-222222222222',path+'#credited','/payments/chapa/return?next=/admin'])expect(miniReturnPath(invalid)).toBe('/');
 });
 it.each(['https://evil.example','//evil.example/auctions/1','/\\evil.example','/admin','/api/me','/telegram?next=/admin','/profile/../admin','/auctions/%2F%2Fevil.example','/auctions/1\n',null,undefined])('rejects an external or noncustomer destination %s',value=>expect(miniReturnPath(value)).toBe('/'));
});
