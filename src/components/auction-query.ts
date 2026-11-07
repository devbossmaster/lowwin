'use client';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {readPublicQuery,seedPublicQuery} from './public-query-cache';

/** Public route codes resolve to the same canonical slug used by sheets. */
export function auctionDetailUrl(slug:string){return `/api/catalog/auctions/${encodeURIComponent(slug)}`}
export function seedAuctionQuery(identity:string|null,auction:CatalogAuction){
 const url=auctionDetailUrl(auction.slug),saved=readPublicQuery<CatalogAuction>(url);
 if(!saved||saved.value.terms.version<auction.terms.version)seedPublicQuery(url,auction);
}
