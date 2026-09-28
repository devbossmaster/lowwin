'use client';
import {ResultExplanation} from '@/components/auction-rule';
import {useWalletCopy} from '@/components/wallet-copy';
import {WinFulfillment} from '@/components/win-fulfillment';
import { useState } from 'react';
import Link from 'next/link';
import styles from '@/components/personal-pages.module.css';
import { usePrivateQuery,PrivateState,PersonalPagination } from '@/components/private-query';
import { CatalogImage } from '@/components/catalog-image';
import {WinnerCelebration} from '@/components/celebration';
import { OfflineRetry } from '@/components/offline-retry';
import type { getPersonalWins } from '@/modules/profile/personal';
import { formatEtb } from '@/lib/money';
export default function Wins() {const w=useWalletCopy();
  const [page,setPage]=useState(1),query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalWins>>>(`/api/profile/wins?page=${page}`),data=query.data;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1>{w("Winning Bids")}</h1></header><PrivateState query={query}/>{data&&<>{data.items.length>0&&<WinnerCelebration id={`personal-win:${data.items[0].code}`}/>} {data.items.length===0&&<p className={styles.empty}>{w("No winning bids found.")}</p>}<div className={styles.wins}>{data.items.map(item=><div key={item.code} className="personal-win"><Link className="result-card" href={`/winners/${item.code}`}><CatalogImage src={item.image?.path} alt={item.image?.alt??item.title}/><div>{item.isDemo&&<small className="demo-label">{w("DEMO · settled test")}</small>}<h2>{item.title}</h2><p>{formatEtb(item.winningPoints)} {w("· winning amount")}</p><small>{new Date(item.closedAt).toLocaleDateString('en',{dateStyle:'medium'})}</small><span>{w("Read result")}</span></div></Link><p><ResultExplanation outcome="WINNER" decision={item.decision}/></p><WinFulfillment auctionId={item.auctionId} isDemo={item.isDemo}/></div>)}</div><PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/></>}</section></>;
}
