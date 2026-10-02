'use client';
import Link from 'next/link';
import {useState} from 'react';
import {PersonalBidCard} from './personal-bid-card';
import {BidPagination} from './bid-pagination';
import {usePrivateQuery,PrivateState} from './private-query';
import {WinnerCelebration} from './celebration';
import {OfflineRetry} from './offline-retry';
import {MiniPhrase} from './mini-locale';
import type {getPersonalWins} from '@/modules/profile/personal';
import styles from '@/app/(mini)/my-bids/my-bids.module.css';

export function WinningBidsPage(){
  const [page,setPage]=useState(1),query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalWins>>>(`/api/profile/wins?page=${page}`),data=query.data;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="Winning Bids" am="ያሸነፉ ጨረታዎች"/></h1></header><PrivateState query={query}/>{query.status==='authenticated'&&data&&<>
    {data.items.length>0&&<WinnerCelebration id={`personal-win:${data.items[0].code}`}/>}
    {data.items.length===0?<div className={styles.empty}><h2><MiniPhrase en="No winning bids yet" am="ያሸነፉ ጨረታዎች ገና የሉም"/></h2><Link href="/auctions/all"><MiniPhrase en="Browse auctions" am="ጨረታዎችን ይመልከቱ"/></Link></div>:<div className={styles.list}>{data.items.map(item=><PersonalBidCard key={item.code} item={{ruleVersion:item.ruleVersion,bidId:item.bidId,amount:item.winningPoints,code:item.code,title:item.title,titleAm:item.titleAm,image:item.image,views:item.views,isDemo:item.isDemo,outcome:'WON'}}/>)}</div>}
    <BidPagination page={page} totalPages={data.totalPages} onPage={setPage}/>
  </>}</section></>;
}
