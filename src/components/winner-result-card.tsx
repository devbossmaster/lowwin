'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,CalendarDays,Coins,Eye,Gavel,Phone,Tag,Trophy,UserRound} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {CatalogImage} from './catalog-image';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import styles from './winners-page.module.css';

function compact(value:string|number){return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}
export function WinnerResultCard({auction}:{auction:CatalogAuction}){
  const {language}=useMiniLocale(),am=language==='am',ref=useRef<HTMLElement>(null),title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
  const [views,setViews]=useState(auction.viewCount);
  const recordView=useCallback(async()=>{const key=`lowwin-auction-view:${auction.slug}`;try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'pending')}catch{}try{const response=await fetch(`/api/catalog/auctions/${encodeURIComponent(auction.slug)}/view`,{method:'POST',cache:'no-store'});if(!response.ok)throw new Error('view');const body=await response.json() as {views?:string};if(body.views)setViews(body.views);try{sessionStorage.setItem(key,'recorded')}catch{}}catch{try{sessionStorage.removeItem(key)}catch{}}},[auction.slug]);
  useEffect(()=>{const node=ref.current;if(!node)return;let timer=0;const observer=new IntersectionObserver(([entry])=>{clearTimeout(timer);if(entry.isIntersecting&&entry.intersectionRatio>=.55)timer=window.setTimeout(recordView,900)},{threshold:[.55]});observer.observe(node);return()=>{clearTimeout(timer);observer.disconnect()}},[recordView]);
  const result=auction.result;
  const ended=new Date(result?.closedAt??auction.endsAt).toLocaleDateString('en',{dateStyle:'medium',timeZone:'Africa/Addis_Ababa'});
  return <article className={styles.card} ref={ref}>
    <div className={styles.image}>
      <Link href={`/winners/${auction.code}`} onClick={recordView} aria-label={`${am?'ውጤቱን ይመልከቱ':'View result for'} ${title}`}><CatalogImage src={auction.product.images[0]?.path} alt={title}/></Link>
      <span className={styles.outcome}><Trophy size={16} aria-hidden="true"/></span><span className={styles.code}>{am?'የጨረታ ኮድ':'AUCTION CODE'} {auction.code}</span>
      <span className={styles.category}><Tag size={12} aria-hidden="true"/><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></span>
    </div>
    <div className={styles.body}>
      <h2><Link href={`/winners/${auction.code}`} onClick={recordView}>{title}</Link></h2>
      {(result?.demoLabel||auction.isDemo)&&<span className={styles.demo}>{result?.demoLabel??'DEMO'}</span>}
      <dl className={styles.winnerDetails}>
        <div><dt><UserRound size={16}/><span>{am?'አሸናፊ':'Winner'}</span></dt><dd>{result?.winnerDisplay??(am?'ስም አልተገለጸም':'Anonymous winner')}</dd></div>
        <div><dt><Coins size={16}/><span>{am?'መጠን':'Amount'}</span></dt><dd>{result?.winningPoints?formatEtb(result.winningPoints):'—'}</dd></div>
        <div><dt><Phone size={16}/><span>{am?'ስልክ':'Phone'}</span></dt><dd>{am?'የግል':'Private'}</dd></div>
      </dl>
      <div className={styles.meta}><span><CalendarDays size={15}/>{ended}</span><span><Gavel size={15}/>{result?.source==='ILLUSTRATIVE'?'DEMO':compact(auction.bidCount)}</span><span><Eye size={15}/>{compact(views)}</span></div>
      <Link className={styles.action} href={`/winners/${auction.code}`} onClick={recordView}>{am?'ውጤቱን ይመልከቱ':'View Results'} <ArrowRight size={17}/></Link>
    </div>
  </article>;
}
