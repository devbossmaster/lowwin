'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,CalendarDays,Eye,Gavel,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {CatalogImage} from './catalog-image';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import styles from './winners-page.module.css';

function compact(value:string|number){return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}
export function WinnerResultCard({auction}:{auction:CatalogAuction}){
  const {language}=useMiniLocale(),am=language==='am',ref=useRef<HTMLElement>(null);
  const [views,setViews]=useState(auction.viewCount);
  const recordView=useCallback(async()=>{const key=`lowwin-auction-view:${auction.slug}`;try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'pending')}catch{}try{const response=await fetch(`/api/catalog/auctions/${encodeURIComponent(auction.slug)}/view`,{method:'POST',cache:'no-store'});if(!response.ok)throw new Error('view');const body=await response.json() as {views?:string};if(body.views)setViews(body.views);try{sessionStorage.setItem(key,'recorded')}catch{}}catch{try{sessionStorage.removeItem(key)}catch{}}},[auction.slug]);
  useEffect(()=>{const node=ref.current;if(!node)return;let timer=0;const observer=new IntersectionObserver(([entry])=>{clearTimeout(timer);if(entry.isIntersecting&&entry.intersectionRatio>=.55)timer=window.setTimeout(recordView,900)},{threshold:[.55]});observer.observe(node);return()=>{clearTimeout(timer);observer.disconnect()}},[recordView]);
  const result=auction.result;
  const state=!result?'pending':result.outcome==='WINNER'?'winner':result.outcome==='NO_WINNER'?'no-winner':'cancelled';
  const label={winner:am?'አሸናፊ':'Winner','no-winner':am?'አሸናፊ የለም':'No winner',cancelled:am?'ተሰርዟል':'Cancelled',pending:am?'ውጤት በመጠባበቅ ላይ':'Result pending'}[state];
  const ended=new Date(result?.closedAt??auction.endsAt).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
  const bidTotal=result?.source==='ILLUSTRATIVE'?(am?'DEMO · እውነተኛ ጨረታ የለም':'DEMO · no real bids'):`${compact(auction.bidCount)} ${am?'የተቀበሉ ጨረታዎች':'accepted bids'}`;
  const visibleViews=compact(views),viewLabel=am?'እይታ':visibleViews==='1'?'view':'views';
  return <article className={styles.card} ref={ref}>
    <div className={styles.image}><Link href={`/winners/${auction.code}`} onClick={recordView}><CatalogImage src={auction.product.images[0]?.path} alt={auction.product.images[0]?.alt??auction.product.title}/></Link><span className={styles.outcome}><Trophy size={14}/>{label}</span><span className={styles.code}>{auction.code}</span><span className={styles.views}><Eye size={14}/>{visibleViews} {viewLabel}</span></div>
    <div className={styles.body}>{(result?.demoLabel||auction.isDemo)&&<span className={styles.demo}>{result?.demoLabel??'DEMO'}</span>}<span className={styles.category}><MiniCategoryName slug={auction.category.slug} name={auction.category.name}/></span><h2><Link href={`/winners/${auction.code}`} onClick={recordView}>{auction.product.title}</Link></h2>
      <div className={`${styles.summary} ${styles[state]}`}><span>{label}</span><strong>{state==='winner'?(result?.winnerDisplay??(am?'ስም ያልተገለጸ አሸናፊ':'Anonymous winner')):state==='no-winner'?(am?'ልዩ መጠን አልነበረም':'No unique amount'):state==='cancelled'?(am?'ጨረታው ተሰርዟል':'Auction cancelled'):(am?'ውጤቱ ገና አልተወሰነም':'Awaiting settlement')}</strong>{state==='winner'&&result?.winningPoints&&<b>{formatEtb(result.winningPoints)}</b>}<small>{result?.source==='ILLUSTRATIVE'?(am?'የDEMO ማሳያ · እውነተኛ አሸናፊ የለም':'DEMO example · no real winner recorded'):state==='pending'?(am?'አሸናፊ አልተገመተም':'No winner is guessed'):(am?'የተረጋገጠ ውጤት':'Settled outcome')}</small></div>
      <div className={styles.metrics}><span><Gavel size={17}/><strong>{bidTotal}</strong></span><span><CalendarDays size={17}/><strong>{ended} EAT</strong></span></div><Link className={styles.action} href={`/winners/${auction.code}`} onClick={recordView}>{am?'ውጤቱን ይመልከቱ':'View results'} <ArrowRight size={17}/></Link>
    </div>
  </article>;
}
