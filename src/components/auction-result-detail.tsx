'use client';
import Link from 'next/link';
import {ArrowLeft,CalendarDays,CheckCircle2,Clock3,Eye,Gavel,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {AuctionGallery} from './auction-gallery';
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import {ProductDescription} from './product-description';
import styles from './auction-result-detail.module.css';

export function AuctionResultDetail({auction}:{auction:CatalogAuction}){
  const {language}=useMiniLocale(),am=language==='am',result=auction.result;
  const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
  const winner=result?.outcome==='WINNER';
  const winnerName=result?.winnerDisplay||(result?.source==='ILLUSTRATIVE'?(am?'የሙከራ አሸናፊ':'Illustrative winner'):(am?'አሸናፊ':'Winner'));
  const end=new Date(result?.closedAt??auction.endsAt);
  const outcome=!result?(am?'ጨረታው አብቋል':'Auction ended'):winner?(am?'ተጠናቋል':'Completed'):result.outcome==='NO_WINNER'?(am?'አሸናፊ የለም':'No winner'):(am?'ጨረታው ተሰርዟል':'Auction cancelled');
  return <article className={styles.page}>
    <Link className={styles.back} href="/winners/all"><ArrowLeft size={19}/><MiniPhrase en="All results" am="ሁሉም ውጤቶች"/></Link>
    <AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo}/>
    <header className={styles.intro}><h1>{title}</h1><p><span><MiniPhrase en="Auction code" am="የጨረታ ኮድ"/>: <strong>{auction.code}</strong></span><span aria-hidden="true">·</span><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></p></header>
    {Number(auction.terms.entryFeePoints)>0&&<div className={styles.fee}><span><MiniPhrase en="Bid service fee" am="የጨረታ አገልግሎት ክፍያ"/></span><strong>{formatEtb(auction.terms.entryFeePoints)}</strong></div>}
    <section className={styles.summary} data-testid="result-summary" aria-label={am?'የጨረታ ውጤት':'Auction result'}>
      {winner&&<Trophy size={38} aria-hidden="true"/>}<h2>{winner?winnerName:outcome}</h2>
      {winner&&result?.winnerPhoneMasked&&<p className={styles.phone}>{result.winnerPhoneMasked}</p>}
      {winner&&result?.winningPoints&&<strong className={styles.amount}>{formatEtb(result.winningPoints)}</strong>}
      {winner&&<p className={styles.closed}>{outcome}</p>}
      {(result?.demoLabel||auction.isDemo)&&<p className={styles.demo}>{result?.demoLabel??'DEMO'} · <MiniPhrase en="No real prize" am="እውነተኛ ሽልማት የለም"/></p>}
    </section>
    <section className={styles.activity} aria-label={am?'የጨረታ መረጃ':'Auction activity'}>
      <h2>{result?<CheckCircle2 size={20}/>:<Clock3 size={20}/>}<MiniPhrase en="Auction ended at" am="ጨረታው ያበቃበት"/></h2>
      <div className={styles.date}><CalendarDays size={19}/><time dateTime={end.toISOString()}>{end.toLocaleDateString('en',{dateStyle:'medium',timeZone:'Africa/Addis_Ababa'})}</time><span>{end.toLocaleTimeString('en',{hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})} EAT</span></div>
      <div className={styles.date}><CalendarDays size={19}/><span lang="am">{end.toLocaleDateString('am-ET-u-ca-ethiopic',{year:'numeric',month:'long',day:'numeric',timeZone:'Africa/Addis_Ababa'})}</span></div>
      <Link className={styles.action} href="/my-bids?view=history"><Eye size={18}/><MiniPhrase en="View my bid history" am="የእኔን የጨረታ ታሪክ ይመልከቱ"/></Link>
      <div className={styles.numbers}><div><Eye size={27}/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div><div><Gavel size={27}/><span><strong>{result?.source==='ILLUSTRATIVE'?'—':auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div></div>
    </section>
    <ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm}/>
  </article>;
}
