'use client';
import {useRef} from 'react';
import Link from 'next/link';
import {ArrowRight,CalendarDays,Eye,Gavel,Tag,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {WinnerSummary} from './winner-summary';
import {CatalogImage} from './catalog-image';
import {MiniCategoryName,useMiniLocale} from './mini-locale';
import {useAuctionActivity} from './auction-activity';
import styles from './winners-page.module.css';

function compact(value:string|number){return new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(value))}
export function WinnerResultCard({auction}:{auction:CatalogAuction}){
  const {language}=useMiniLocale(),am=language==='am',ref=useRef<HTMLElement>(null),title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
  const {activity,views}=useAuctionActivity(auction.code,{element:ref,record:true});
  const result=auction.result;
  const ended=new Date(result?.closedAt??auction.endsAt).toLocaleDateString('en',{dateStyle:'medium',timeZone:'Africa/Addis_Ababa'});
  return <article className={styles.card} ref={ref}>
    <div className={styles.image}>
      <Link href={`/auctions/${auction.code}`} aria-label={`${am?'ውጤቱን ይመልከቱ':'View result for'} ${title}`}><CatalogImage src={auction.product.images[0]?.path} alt={title}/></Link>
      <span className={styles.outcome}>{result?.outcome==='WINNER'?<Trophy size={18} aria-hidden="true"/>:<Gavel size={18} aria-hidden="true"/>}</span><span className={styles.code}>{am?'የጨረታ ኮድ':'AUCTION CODE'} {auction.code}</span>
      <span className={styles.category}><Tag size={12} aria-hidden="true"/><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></span>
    </div>
    <div className={styles.body}>
      <h2><Link href={`/auctions/${auction.code}`}>{title}</Link></h2>
      {(result?.demoLabel||auction.isDemo)&&<span className={styles.demo}>{result?.demoLabel??'DEMO'}</span>}
      <WinnerSummary auction={auction}/>
      <div className={styles.meta}><span><CalendarDays size={15}/>{ended}</span><span><Gavel size={15}/>{result?.source==='ILLUSTRATIVE'?'DEMO':compact(activity?.bids??auction.bidCount)}</span><span><Eye size={15}/>{compact(views??auction.viewCount)}</span></div>
      <Link className={styles.action} href={`/auctions/${auction.code}`}>{am?'ውጤቱን ይመልከቱ':'View Results'} <ArrowRight size={17}/></Link>
    </div>
  </article>;
}
