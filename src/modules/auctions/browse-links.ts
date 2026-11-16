import type {CatalogQuery} from './catalog';
import {homeAuctionHref} from '@/lib/home-filter-query';

/** Customer URLs contain only public filters, never private query snapshots. */
export function auctionBrowseHref(query:CatalogQuery,changes:Partial<CatalogQuery>={}):string{
  // Home owns the catalogue now. Only forward the filters it actually supports;
  // its live-only feed restores pagination independently.
  return homeAuctionHref(query,changes);
}
