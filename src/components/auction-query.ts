'use client';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {isPrivateQueryIdentity,readPrivateQuery,seedPrivateQuery} from './private-query-cache';

/** Public route codes resolve to the same canonical slug used by sheets. */
export function auctionDetailUrl(slug:string){return `/api/catalog/auctions/${encodeURIComponent(slug)}`}
export function seedAuctionQuery(identity:string|null,auction:CatalogAuction){
 if(!identity||!isPrivateQueryIdentity(identity))return;
 const url=auctionDetailUrl(auction.slug),saved=readPrivateQuery<CatalogAuction>(identity,url);
 if(!saved||saved.value.terms.version<auction.terms.version)seedPrivateQuery(identity,url,auction);
}
