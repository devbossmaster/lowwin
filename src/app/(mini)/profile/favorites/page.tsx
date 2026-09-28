'use client';
import { useState } from 'react';
import styles from '@/components/personal-pages.module.css';
import { usePrivateQuery,PrivateState,PersonalPagination } from '@/components/private-query';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import type { getFavorites } from '@/modules/profile/personal';
export default function Favorites() {
  const [page,setPage]=useState(1),query=usePrivateQuery<Awaited<ReturnType<typeof getFavorites>>>(`/api/favorites?page=${page}`),data=query.data;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1>My Favorites</h1></header><PrivateState query={query}/>{data&&<>{data.total>0&&<p className={styles.savedCount}>{data.total} saved {data.total===1?'auction':'auctions'}</p>}{data.items.length===0&&<p className={styles.empty}>No favorites found.</p>}<div className={styles.list}>{data.items.map(auction=><div key={auction.code}><AuctionCard auction={auction} serverNow={data.serverNow} onFavoriteChanged={query.reload}/></div>)}</div><PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/></>}</section></>;
}
