'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useCallback,useRef,useState} from 'react';
import Link from 'next/link';
import {PersonalBidCard} from './personal-bid-card';
import {BidPagination} from './bid-pagination';
import {usePrivateQuery,PrivateState} from './private-query';
import {OfflineRetry} from './offline-retry';
import type {getPersonalBids} from '@/modules/profile/personal';
import styles from '@/app/(mini)/my-bids/my-bids.module.css';

export function MyBidsPage({initialView='live'}:{initialView?:'live'|'history'}){
  const w=useWalletCopy(),[view,setView]=useState<'live'|'history'>(initialView),[page,setPage]=useState(1);
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalBids>>>(`/api/my-bids?view=${view}&page=${page}`),data=query.data;
  const lastReload=useRef(0),reload=query.reload;
  const onSettled=useCallback(()=>{if(Date.now()-lastReload.current<2000)return;lastReload.current=Date.now();reload()},[reload]);
  return <><OfflineRetry/><section className={styles.page}>
    <header className={styles.heading}><h1>{w('My Bids')}</h1></header>
    <div className={styles.tabs} role="group" aria-label="My bids category">{(['live','history'] as const).map(tab=><button type="button" key={tab} aria-pressed={view===tab} onClick={()=>{setView(tab);setPage(1)}}>{w(tab==='live'?'Live':'History')}{data&&<span>{data.counts[tab]}</span>}</button>)}</div>
    <PrivateState query={query}/>{query.status==='authenticated'&&data&&<>
      {data.items.length===0?<div className={styles.empty}><h2>{w(view==='live'?'No live bids yet':'No bid history yet')}</h2><p>{w(view==='live'?'Your bids in open auctions will appear here.':'Your bids in ended auctions will appear here.')}</p><Link href="/auctions/all">{w('Browse auctions')}</Link></div>:<div className={styles.list}>{data.items.map(item=><PersonalBidCard key={item.id} onSettled={onSettled} item={{ruleVersion:item.auction.ruleVersion,bidId:item.id,amount:item.amount,code:item.auction.code,title:item.auction.title,titleAm:item.auction.titleAm,image:item.auction.image,views:item.auction.views,isDemo:item.auction.isDemo,outcome:item.outcome}}/>)}</div>}
      <BidPagination page={page} totalPages={data.totalPages} onPage={setPage}/>
    </>}
  </section></>;
}
