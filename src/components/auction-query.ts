'use client';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {readPrivateQuery,seedPrivateQuery} from './private-query-cache';

/** Public route codes resolve to the same canonical slug used by sheets. */
export function auctionDetailUrl(slug:string){return `/api/catalog/auctions/${encodeURIComponent(slug)}`}
export function isNewerAuction(candidate:CatalogAuction,current:CatalogAuction){
 return candidate.terms.version>current.terms.version||
  (candidate.terms.version===current.terms.version&&(candidate.presentationVersion??0)>(current.presentationVersion??0));
}
export function seedAuctionQuery(identity:string|null,auction:CatalogAuction){
 if(!identity)return;
 const url=auctionDetailUrl(auction.slug),saved=readPrivateQuery<CatalogAuction>(identity,url);
 if(!saved||isNewerAuction(auction,saved.value))seedPrivateQuery(identity,url,auction);
}
