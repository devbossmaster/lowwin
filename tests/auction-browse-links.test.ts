import {describe,expect,it} from 'vitest';
import {auctionBrowseHref} from '../src/modules/auctions/browse-links';
import type {CatalogQuery} from '../src/modules/auctions/catalog';

describe('customer browse links',()=>{
 const query:CatalogQuery={q:'coffee & tea',status:'live',category:'home',sort:'fee-low',page:3};
 it('preserves filters while changing sort or category and resetting the page',()=>{
  const sort=new URL(auctionBrowseHref(query,{sort:'fee-high',page:1}),'http://localhost');
  expect(Object.fromEntries(sort.searchParams)).toEqual({q:'coffee & tea',status:'live',category:'home',sort:'fee-high'});
  const category=new URL(auctionBrowseHref(query,{category:'phones',page:1}),'http://localhost');
  expect(category.searchParams.get('sort')).toBe('fee-low');expect(category.searchParams.get('q')).toBe(query.q);expect(category.searchParams.get('category')).toBe('phones');expect(category.searchParams.has('page')).toBe(false);
 });
 it('keeps explicit legacy ordering and removes only actual UI defaults',()=>{
  expect(auctionBrowseHref({q:'',status:'all',sort:'newest',page:1})).toBe('/auctions/all');
  expect(auctionBrowseHref({q:'',status:'all',sort:'code',page:1})).toBe('/auctions/all?sort=code');
  expect(auctionBrowseHref(query,{category:undefined,page:2})).toContain('page=2');
  expect(new URL(auctionBrowseHref(query,{category:undefined}),'http://localhost').searchParams.has('category')).toBe(false);
 });
});
