'use client';
import Link from 'next/link';
import {CalendarDays,Clock3,Trophy} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAuctionBid,formatEtb} from '@/lib/money';
import styles from './account-pages.module.css';

export function DrawsList({items,tab}:{items:CatalogAuction[];tab:'past'|'upcoming'}){
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const date=(value:string)=>new Date(value).toLocaleString(am?'am-ET':'en',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'});
  if(!items.length)return <div className={styles.empty}><Trophy size={28} aria-hidden="true"/><h2>{tab==='past'?text('The results will be here','ውጤቶች እዚህ ይታያሉ'):text('No upcoming draws yet','ቀጣይ ጨረታዎች ገና የሉም')}</h2><p>{tab==='past'?text('Finalized results are published after each auction.','ከእያንዳንዱ ጨረታ በኋላ የመጨረሻ ውጤቶች ይታተማሉ።'):text('New schedules will appear here when published.','አዲስ የጊዜ ሰሌዳዎች ሲታተሙ እዚህ ይታያሉ።')}</p><Link className={styles.action} href="/auctions/all">{text('Explore auctions','ጨረታዎችን ይመልከቱ')}</Link></div>;
  return <div className={`${styles.list} ${tab==='past'?styles.results:''}`}>{items.map(auction=>{
    const title=am?auction.product.titleAm||auction.product.title:auction.product.title,result=auction.result;
    if(tab==='upcoming')return <Link key={auction.code} className={styles.drawCard} href={`/auctions/${auction.code}`}><CatalogImage className={styles.drawImage} src={auction.product.images[0]?.path} alt={title}/><div className={styles.rowBody}><h2>{title}</h2><span className={styles.rowMeta}><CalendarDays size={13} aria-hidden="true"/>{date(auction.endsAt)}</span><span className={styles.rowStatus}><span className={`${styles.pill} ${styles.gold}`}>{text('Fee','ክፍያ')} {formatEtb(auction.terms.entryFeePoints)}</span><span className={styles.pill}><Clock3 size={11} aria-hidden="true"/>{auction.status==='upcoming'?text('Opens','ይጀምራል')+': '+date(auction.startsAt):text('Bidding open','ጨረታው ክፍት ነው')}</span></span></div></Link>;
    const won=result?.source==='SETTLED'&&result.outcome==='WINNER';
    const state=won?text('Final result','የመጨረሻ ውጤት'):auction.status==='cancelled'||result?.outcome==='CANCELLED'?text('Cancelled','ተሰርዟል'):result?.outcome==='NO_WINNER'?text('No winner','አሸናፊ የለም'):text('Result pending','ውጤት በመጠባበቅ ላይ');
    return <article className={styles.resultCard} key={auction.code}><Link href={`/auctions/${auction.code}`} tabIndex={-1} aria-hidden="true"><CatalogImage className={styles.resultImage} src={auction.product.images[0]?.path} alt=""/></Link><div className={styles.resultBody}><span className={`${styles.pill} ${won?styles.gold:''}`}>{won&&<Trophy size={11} aria-hidden="true"/>}{state}</span><h2 style={{marginTop:10}}><Link href={`/auctions/${auction.code}`}>{title}</Link></h2>{won?<dl className={styles.resultFacts}><div><dt>{text('Winner','አሸናፊ')}</dt><dd>{result.winnerPhoneMasked??text('Anonymous bidder','ስሙ ያልተገለጸ ተጫራች')}</dd></div><div><dt>{auction.terms.ruleVersion==='lowest-unique-v4'?text('Winning number','ያሸነፈው ቁጥር'):text('Winning amount','ያሸነፈው መጠን')}</dt><dd>{result.winningPoints?formatAuctionBid(result.winningPoints,auction.terms.ruleVersion):'—'}</dd></div></dl>:<p className={styles.caption}>{auction.status==='cancelled'||result?.outcome==='CANCELLED'?text('See the auction’s published cancellation terms.','የጨረታውን የታተሙ የስረዛ ውሎች ይመልከቱ።'):result?text('The finalized result has no winner.','የመጨረሻ ውጤቱ አሸናፊ የለውም።'):text('The final result has not been published yet.','የመጨረሻ ውጤቱ ገና አልታተመም።')}</p>}<div className={styles.resultFooter}><span>{date(result?.closedAt??auction.endsAt)}</span><span>#{auction.code}</span></div></div></article>;
  })}</div>;
}
