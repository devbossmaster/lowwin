import type {CatalogQuery} from './catalog';

/** Customer URLs contain only public filters, never private query snapshots. */
export function auctionBrowseHref(query:CatalogQuery,changes:Partial<CatalogQuery>={}):string{
  const next={...query,...changes},params=new URLSearchParams();
  if(next.q)params.set('q',next.q);
  if(next.status!=='all')params.set('status',next.status);
  if(next.category)params.set('category',next.category);
  if(next.sort!=='newest')params.set('sort',next.sort);
  if(next.page>1)params.set('page',String(next.page));
  const suffix=params.toString();
  return `/auctions/all${suffix?`?${suffix}`:''}`;
}
