'use client';
import type {CatalogQuery,listAuctions} from '@/modules/auctions/catalog';
import {catalogBatchUrl} from '@/lib/catalog-query';
import {AuctionCard} from './auction-card';
import {usePrivateQuery} from './private-query';

export function CatalogAuctionList({initial,query,className}:{initial:Awaited<ReturnType<typeof listAuctions>>;query:CatalogQuery;className:string}){
 const snapshot=usePrivateQuery<typeof initial>(catalogBatchUrl(query),{initialData:initial}),data=snapshot.data??initial;
 return <div className={className}>{data.items.map((item,index)=><AuctionCard key={item.code} auction={item} serverNow={data.serverNow} serverObservedAt={snapshot.updatedAt} priority={index===0}/>)}</div>;
}
