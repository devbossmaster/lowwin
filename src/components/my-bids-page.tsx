'use client';
import {useWalletCopy} from '@/components/wallet-copy';
import {useCallback,useRef} from 'react';
import Link from 'next/link';
import {PersonalBidCard} from './personal-bid-card';
import {BidPagination} from './bid-pagination';
import {usePrivateQuery,PrivateState} from './private-query';
import {OfflineRetry} from './offline-retry';
import type {getPersonalBids} from '@/modules/profile/personal';
import styles from '@/app/(mini)/my-bids/my-bids.module.css';
import {useMiniPage,useMiniQueryState} from './mini-query-state';
import {MiniRouteSkeleton} from './mini-route-skeleton';

export function MyBidsPage({initialView='live'}:{initialView?:'live'|'history'}){
  const w=useWalletCopy(),{params,set}=useMiniQueryState(),[page,setPage]=useMiniPage();
  const view=params.get('view')==='history'?'history':params.has('view')?'live':initialView;
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalBids>>>(`/api/my-bids?view=${view}&page=${page}`),data=query.data;
  const lastReload=useRef(0),reload=query.reload;
  const onSettled=useCallback(()=>{if(Date.now()-lastReload.current<2000)return;lastReload.current=Date.now();reload()},[reload]);
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page}>
    <header className={styles.heading}><h1>{w('My Bids')}</h1></header>
    <div className={styles.tabs} role="group" aria-label="My bids category">{(['live','history'] as const).map(tab=><button type="button" key={tab} aria-pressed={view===tab} onClick={()=>{set({view:tab,page:null})}}>{w(tab==='live'?'Live':'History')}{data&&<span>{data.counts[tab]}</span>}</button>)}</div>
    <PrivateState query={query} variant="bids"/>{query.status==='authenticated'&&data&&<>
      {data.items.length===0?<div className={styles.empty}><h2>{w(view==='live'?'No live bids yet':'No bid history yet')}</h2><p>{w(view==='live'?'Your bids in open auctions will appear here.':'Your bids in ended auctions will appear here.')}</p><Link href="/auctions/all">{w('Browse auctions')}</Link></div>:<div className={styles.list}>{data.items.map(item=><PersonalBidCard key={item.id} onSettled={onSettled} item={{ruleVersion:item.auction.ruleVersion,bidId:item.id,amount:item.amount,code:item.auction.code,title:item.auction.title,titleAm:item.auction.titleAm,image:item.auction.image,views:item.auction.views,isDemo:item.auction.isDemo,outcome:item.outcome}}/>)}</div>}
      <BidPagination page={page} totalPages={data.totalPages} onPage={setPage}/>
    </>}
  </section></>;
}
