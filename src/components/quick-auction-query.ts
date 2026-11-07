'use client';
import {catalogBatchUrl} from '@/lib/catalog-query';
import {quickAuctionUrl} from '@/lib/quick-auction-pages';
import {readPublicQuery} from './public-query-cache';

/** Reuse an already-loaded, unfiltered ten-row Home batch with identical order.
 * Other filters and the smaller upcoming projection keep their own resources. */
export function quickAuctionResource(identity:string|null,status:'live'|'upcoming',page=1){
 if(status==='live'){
  const matching=catalogBatchUrl({status:'live',sort:'code',page,q:''});
  if(readPublicQuery(matching))return matching;
 }
 return quickAuctionUrl(status,page);
}
