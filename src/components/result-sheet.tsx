'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {CalendarDays,Phone,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAuctionBid} from '@/lib/money';
import {winnerResultExplanation} from '@/lib/winner-result-copy';
import {AccountSheet} from './account-sheet';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {WinnerBanner,winnerBannerData} from './winner-banner';
import {usePublicQuery} from './public-query';
import {auctionDetailUrl} from './auction-query';
import styles from './winner-results.module.css';

const Breakdown=dynamic(()=>import('./result-sheet-content'),{loading:()=> <p className={styles.loading} role="status"><MiniPhrase en="Loading bid numbers…" am="የጨረታ ቁጥሮችን በመጫን ላይ…"/></p>});
/** Open from the published card. Only the breakdown waits for visibility. */
export default function ResultSheet({auction:initial,onClose,returnFocusRef}:{auction:CatalogAuction;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 return <AccountSheet title={<span className={styles.resultBadge}><Trophy size={13} aria-hidden="true"/><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></span>} onClose={onClose} returnFocusRef={returnFocusRef}><ResultSheetContent auction={initial}/></AccountSheet>;
}
/** Reuse the published-result surface inside an already-open auction sheet. */
export function ResultSheetContent({auction:initial}:{auction:CatalogAuction}){
 const {language}=useMiniLocale(),am=language==='am',section=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 const query=usePublicQuery<CatalogAuction>(auctionDetailUrl(initial.slug),{initialData:initial,freshnessMs:initial.result?300000:15000});
 const auction=query.data?.result?query.data:initial,result=auction.result;
 const title=am?auction.product.titleAm?.trim()||auction.product.title:auction.product.title;
 const winner=result?.outcome==='WINNER',identity=result?.winnerDisplay||result?.winnerUsername;
 useEffect(()=>{const node=section.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'80px'});observer.observe(node);return()=>observer.disconnect()},[!!result]);
 return <div className={styles.resultSurface}>
   <div className={winnerBannerData(auction)?styles.detailBanner:styles.detailPhoto}>{winnerBannerData(auction)?<WinnerBanner auction={auction}/>:<CatalogImage src={auction.product.images[0]?.path} alt={title}/>}</div>
   <h3 className={styles.title}>{title}</h3>
   {result?.publishedAt&&<p className={styles.date}><CalendarDays size={13} aria-hidden="true"/><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{new Date(result.publishedAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time></p>}
   {result?<section className={styles.winnerSummary} aria-label={am?'የተረጋገጠ ውጤት':'Confirmed result'}>
    {winner&&result?.winningPoints&&<strong className={styles.winningNumber}>{formatAuctionBid(result.winningPoints,auction.terms.ruleVersion)}</strong>}
    <div className={styles.winnerIdentity}><small><MiniPhrase en={winner?'Winner':'Auction completed'} am={winner?'አሸናፊ':'ጨረታው ተጠናቋል'}/></small>{winner&&<strong>{identity||<MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/>}</strong>}{result?.winnerUsername&&result.winnerDisplay&&<span>{result.winnerUsername}</span>}{result?.winnerPhoneMasked&&<span><Phone size={11} aria-hidden="true"/>{result.winnerPhoneMasked}</span>}</div>
    <p className={styles.selection}>{result&&winnerResultExplanation(result,am)}</p><p className={styles.summaryReference}><MiniPhrase en="Auction" am="ጨረታ"/> #{auction.code}</p>
   </section>:<p className={styles.loading} role="status"><MiniPhrase en={auction.status==='cancelled'?'This auction was cancelled.':'Finalizing result'} am={auction.status==='cancelled'?'ይህ ጨረታ ተሰርዟል።':'ውጤቱ እየተጠናቀቀ ነው'}/></p>}
   {result&&<div ref={section} data-result-breakdown tabIndex={-1}>{visible?<Breakdown key={auction.code} code={auction.code}/>:<p className={styles.loading}><MiniPhrase en="Number breakdown" am="የቁጥሮች ዝርዝር"/></p>}</div>}
  </div>;
}
