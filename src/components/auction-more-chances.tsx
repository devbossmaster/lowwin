'use client';
import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import type {listAuctions} from '@/modules/auctions/catalog';
import {catalogBatchUrl} from '@/lib/catalog-query';
import {AuctionCard} from './auction-card';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {usePublicQuery} from './public-query';
import styles from './auction-detail.module.css';

type Batch=Awaited<ReturnType<typeof listAuctions>>;
// Reuse Home's bounded public catalogue key, cache and request deduplication.
const liveCatalog=catalogBatchUrl({status:'live',sort:'featured',page:1,q:''});
export function AuctionMoreChances({currentCode}:{currentCode:string}){
 const {language}=useMiniLocale(),am=language==='am';
 const query=usePublicQuery<Batch>(liveCatalog);
 const now=query.data?Date.parse(query.data.serverNow):0;
 const items=query.data?.items.filter(item=>item.code!==currentCode&&item.status==='live'&&Date.parse(item.startsAt)<=now&&Date.parse(item.endsAt)>now).slice(0,6)??[];
 if(query.data&&!items.length)return null;
 return <section className={styles.moreChances} aria-label={am?'ተጨማሪ ዕድሎች':'More chances'} data-more-chances>
  <header><div><small><MiniPhrase en="Happening now" am="አሁን ክፍት"/></small><h2><MiniPhrase en="More chances" am="ተጨማሪ ዕድሎች"/></h2></div><Link href="/#discover-auctions"><MiniPhrase en="See all" am="ሁሉንም ይመልከቱ"/><ArrowRight size={14} aria-hidden="true"/></Link></header>
  {items.length?<div className={styles.chancesRail} role="region" aria-label={am?'ሌሎች ክፍት ጨረታዎች':'Other live auctions'} tabIndex={0}>{items.map(item=><AuctionCard key={item.code} auction={item} serverNow={query.data!.serverNow} serverObservedAt={query.updatedAt}/>)}</div>:query.error?<div className={styles.chancesMessage}><p><MiniPhrase en="Other auctions could not load." am="ሌሎች ጨረታዎች መጫን አልተቻለም።"/></p><button type="button" onClick={query.reload}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>:<div className={styles.chancesLoading} aria-busy="true"><span/><span/><span className="sr-only"><MiniPhrase en="Loading live auctions…" am="ክፍት ጨረታዎችን በመጫን ላይ…"/></span></div>}
 </section>;
}
