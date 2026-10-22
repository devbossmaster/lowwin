'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {ChevronRight,Trophy} from 'lucide-react';
import {useMiniPage} from './mini-query-state';
import {BidPagination} from './bid-pagination';
import {usePrivateQuery,PrivateState} from './private-query';
import {OfflineRetry} from './offline-retry';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {CatalogImage} from './catalog-image';
import {formatAuctionBid} from '@/lib/money';
import type {getPersonalWins} from '@/modules/profile/personal';
import styles from './account-pages.module.css';
import {MiniRouteSkeleton} from './mini-route-skeleton';
const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet));
type Win=Awaited<ReturnType<typeof getPersonalWins>>['items'][number];
export function WinningBidsPage(){const {queryIdentity}=useTelegram();return <PlayerWins key={queryIdentity??'guest'}/>}
function PlayerWins(){
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const [page,setPage]=useMiniPage(),[selected,setSelected]=useState<Win|null>(null),query=usePrivateQuery<Awaited<ReturnType<typeof getPersonalWins>>>(`/api/profile/wins?page=${page}`),data=query.data;
  const title=(item:Win)=>am?item.titleAm||item.title:item.title;
  const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1><MiniPhrase en="My wins" am="ያሸነፍኳቸው"/></h1><p><MiniPhrase en="Your finalized winning entries." am="የመጨረሻ ውጤት ያገኙ አሸናፊ ጨረታዎችዎ።"/></p></header><PrivateState query={query} variant="wins"/>{data&&<>{data.items.length===0?<div className={styles.empty}><Trophy size={28} aria-hidden="true"/><h2><MiniPhrase en="No winning bids yet" am="ያሸነፉ ጨረታዎች ገና የሉም"/></h2><p><MiniPhrase en="Your wins will appear after results are finalized." am="ውጤቶች ሲጠናቀቁ ድሎችዎ እዚህ ይታያሉ።"/></p><Link className={styles.action} href="/auctions/all"><MiniPhrase en="Explore auctions" am="ጨረታዎችን ይመልከቱ"/></Link></div>:<div className={styles.list}>{data.items.map(item=><button className={styles.bidRow} type="button" key={item.code} onClick={()=>setSelected(item)}><CatalogImage className={styles.drawImage} src={item.image?.path} alt=""/><span className={styles.rowBody}><span className={styles.rowTitle}>{title(item)}</span><span className={styles.pill}><Trophy size={11} aria-hidden="true"/>{text('Won','አሸንፈዋል')}{item.isDemo?' · DEMO':''}</span><span className={styles.rowMeta}>{formatAuctionBid(item.winningPoints,item.ruleVersion)} · {date(item.closedAt)}</span></span><ChevronRight size={17} aria-hidden="true"/></button>)}</div>}<BidPagination page={page} totalPages={data.totalPages} onPage={setPage}/></>}</section>{selected&&query.status==='authenticated'&&<AccountSheet title={text('Winning entry','አሸናፊ ጨረታ')} onClose={()=>setSelected(null)} footer={<Link className={styles.action} href={`/auctions/${selected.code}`} onClick={()=>setSelected(null)}>{text('View result & delivery','ውጤት እና ማድረስ ይመልከቱ')}</Link>}><div className={styles.receiptTitle}><h3>{title(selected)}</h3><div className={styles.receiptNumber}>{formatAuctionBid(selected.winningPoints,selected.ruleVersion).replace(/^ETB\s*/, '')}</div></div><dl className={styles.facts}><div><dt>{text('Auction','ጨረታ')}</dt><dd>{selected.code}</dd></div><div><dt>{text('Finalized','የተጠናቀቀበት')}</dt><dd>{date(selected.closedAt)}</dd></div><div><dt>{text('Receipt ID','የደረሰኝ መለያ')}</dt><dd>{selected.bidId??'—'}</dd></div></dl><p className={styles.caption}>{text('Open the auction to see its current delivery status and claim instructions.','ወቅታዊ የማድረስ ሁኔታውን እና የመቀበያ መመሪያዎችን ለማየት ጨረታውን ይክፈቱ።')}</p></AccountSheet>}</>;
}
