import {afterEach,describe,expect,it,vi} from 'vitest';
import {isPublicMiniPage,isPublicMiniRead} from '../src/lib/mini-public-routes';
import {publicQueryKey,seedPublicQuery,readPublicQuery} from '../src/components/public-query-cache';
import {readPrivateQuery,seedPrivateQuery,setPrivateQueryIdentity} from '../src/components/private-query-cache';
afterEach(()=>{setPrivateQueryIdentity(null);vi.unstubAllGlobals()});
describe('explicit public display boundary',()=>{
 it.each(['/','/auctions/5','/categories/accessories','/winners/5','/how-it-works','/terms'])('allows browsing %s',path=>expect(isPublicMiniPage(path)).toBe(true));
 it.each(['/profile','/profile/alerts','/my-bids','/wallet','/payments','/admin','/auctions/item/private'])('keeps personal/unknown routes out of the public allowlist %s',path=>expect(isPublicMiniPage(path)).toBe(false));
 it.each(['/api/catalog/auctions','/api/catalog/auctions/rugass','/api/catalog/activity','/api/results/5','/api/results/5/breakdown','/api/results/winners'])('permits only read methods on %s',path=>{expect(isPublicMiniRead(path)).toBe(true);for(const method of ['POST','PATCH','DELETE'])expect(isPublicMiniRead(path,method)).toBe(false)});
 it.each(['/api/wallet','/api/me','/api/profile','/api/alerts','/api/my-bids','/api/payments/chapa/checkouts','/api/catalog/auctions/rugass/view','/api/catalog/auctions/rugass/bids'])('refuses account or mutation response caching %s',url=>{expect(isPublicMiniRead(url)).toBe(false);expect(()=>publicQueryKey(url)).toThrow('not public')});
 it('deduplicates equivalent public query parameter order in a separate namespace',()=>{expect(publicQueryKey('/api/catalog/auctions?sort=newest&page=2')).toEqual(publicQueryKey('/api/catalog/auctions?page=2&sort=newest'));expect(publicQueryKey('/api/catalog/auctions')[0]).toBe('lowin-public')});
 it('keeps participant contact drilldowns outside the public cache',()=>expect(()=>publicQueryKey('/api/results/5/breakdown?amount=1.25')).toThrow('not public'));
 it('does not accept another origin as a public resource',()=>expect(()=>publicQueryKey('https://other.test/api/catalog/auctions')).toThrow('not public'));
 it('reuses public snapshots through login and account changes while discarding private balances',()=>{
  vi.stubGlobal('window',{});
  seedPublicQuery('/api/catalog/auctions',{items:[{code:'public-auction'}]});
  setPrivateQueryIdentity('first-session');seedPrivateQuery('first-session','/api/wallet',{available:'10.00'});
  setPrivateQueryIdentity('second-session');
  expect(readPrivateQuery('first-session','/api/wallet')).toBeNull();expect(readPrivateQuery('second-session','/api/wallet')).toBeNull();
  expect(readPublicQuery('/api/catalog/auctions')?.value).toEqual({items:[{code:'public-auction'}]});
 });
});
