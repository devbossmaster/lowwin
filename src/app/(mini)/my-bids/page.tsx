'use client';
import {CatalogImage} from '@/components/catalog-image';
import { useState } from 'react';
import Link from 'next/link';
import { usePrivateQuery,PrivateState,PersonalPagination } from '@/components/private-query';
import { OfflineRetry } from '@/components/offline-retry';
import type { getPersonalBids } from '@/modules/profile/personal';
import { formatEtb } from '@/lib/money';
const outcomes:Record<string,string>={LIVE:'Accepted · auction open',PENDING:'Closing / result pending',WON:'Winning bid',LOST:'Auction closed · not the winning bid',NO_WINNER:'No winner',CANCELLED:'Cancelled'};
export default function MyBids() {
  const [view,setView]=useState<'live'|'history'>('live'),[page,setPage]=useState(1);
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalBids>>>(`/api/my-bids?view=${view}&page=${page}`),data=query.data;
  return <><OfflineRetry/><section className="page-inset"><h1 className="page-title">My bids<span className="title-dot">.</span></h1><p className="page-lead">Your accepted amounts and final outcomes. Live uniqueness stays private.</p><PrivateState query={query}/>
    {query.status==='authenticated'&&<><div className="personal-tabs" role="group" aria-label="Bid history">{(['live','history'] as const).map(tab=><button key={tab} aria-pressed={view===tab} onClick={()=>{setView(tab);setPage(1)}}>{tab==='live'?'Live':'History'}{data?` (${data.counts[tab]})`:''}</button>)}</div>
      {data?.items.length===0&&<div className="empty-state"><h2>{view==='live'?'No live bids':'No bid history yet'}</h2><p>{view==='live'?'Your accepted bids in open auctions appear here.':'Ended and cancelled auctions will appear here with their outcomes.'}</p><Link className="text-link" href="/auctions?status=live">Browse auctions</Link></div>}
      <div className="personal-bid-list">{data?.items.map(item=><Link key={item.id} href={item.outcome==='LIVE'?`/auctions/${item.auction.slug}`:`/winners/${item.auction.code}`} className="personal-bid-row"><CatalogImage src={item.auction.image?.path} alt={item.auction.image?.alt??item.auction.title}/>{item.auction.isDemo&&<small className="demo-label">DEMO test bid</small>}<strong>{item.auction.title}</strong><span className="own-amount">{formatEtb(item.amount)}</span><b className="own-outcome">{outcomes[item.outcome]}</b><span>{item.auction.code}</span><small>Accepted {new Date(item.acceptedAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}</small><small>{item.outcome==='CANCELLED'?`Entry fee refunded: ${formatEtb(item.feeRefunded)}`:`Entry fee: ${formatEtb(item.feePoints)}${['WON','LOST','NO_WINNER'].includes(item.outcome)?' · retained':''}`}</small></Link>)}</div>
      <PersonalPagination page={page} totalPages={data?.totalPages??0} setPage={setPage}/></>}
  </section></>;
}
