'use client';
import {useMiniPage} from '@/components/mini-query-state';

import styles from '@/components/personal-pages.module.css';
import { usePrivateQuery,PrivateState,PersonalPagination } from '@/components/private-query';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import type { getFavorites } from '@/modules/profile/personal';
import {useMiniLocale} from '@/components/mini-locale';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
export default function Favorites() {
  const {language}=useMiniLocale(),am=language==='am';
  const [page,setPage]=useMiniPage(),query=usePrivateQuery<Awaited<ReturnType<typeof getFavorites>>>(`/api/favorites?page=${page}`),data=query.data;
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1>{am?'ተወዳጆቼ':'My Favorites'}</h1></header><PrivateState query={query} variant="favorites"/>{data&&<>{data.total>0&&<p className={styles.savedCount}>{am?`${data.total} የተቀመጡ ጨረታዎች`:`${data.total} saved ${data.total===1?'auction':'auctions'}`}</p>}{data.items.length===0&&<p className={styles.empty}>{am?'ምንም ተወዳጅ ጨረታ የለም።':'No favorites found.'}</p>}<div className={styles.list}>{data.items.map(auction=><div key={auction.code}><AuctionCard auction={auction} serverNow={data.serverNow} onFavoriteChanged={query.reload}/></div>)}</div><PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/></>}</section></>;
}
