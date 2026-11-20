'use client';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {CalendarDays,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {AccountSheet} from './account-sheet';
import {AuctionResultSummary} from './auction-result-summary';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {WinnerBanner,winnerBannerData} from './winner-banner';
import {PrivateState,usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import styles from './winner-results.module.css';

const Breakdown=dynamic(()=>import('./result-sheet-content'),{loading:()=> <p className={styles.loading} role="status"><MiniPhrase en="Loading bid numbers…" am="የጨረታ ቁጥሮችን በመጫን ላይ…"/></p>});
/** Open from the published card. Only the breakdown waits for visibility. */
export default function ResultSheet({auction:initial,onClose,returnFocusRef}:{auction:CatalogAuction;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const {status,me,queryIdentity}=useTelegram();
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 return <AccountSheet title={<span className={styles.resultBadge}><Trophy size={13} aria-hidden="true"/><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></span>} onClose={onClose} returnFocusRef={returnFocusRef}><ResultSheetContent auction={initial}/></AccountSheet>;
}
/** Reuse the published-result surface inside an already-open auction sheet. */
export function ResultSheetContent({auction:initial}:{auction:CatalogAuction}){
 const {language}=useMiniLocale(),am=language==='am',section=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 const query=usePrivateQuery<CatalogAuction>('/api/results/'+encodeURIComponent(initial.code),{initialData:initial.result?.explanation?initial:undefined,freshnessMs:initial.result?.explanation?300000:15000});
 const auction=query.data?.result?query.data:initial,result=auction.result;
 const title=am?auction.product.titleAm?.trim()||auction.product.title:auction.product.title;
 useEffect(()=>{const node=section.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'80px'});observer.observe(node);return()=>observer.disconnect()},[!!result]);
 if(query.status!=='authenticated')return <PrivateState query={query}/>;
 return <div className={styles.resultSurface}>
   <div className={winnerBannerData(auction)?styles.detailBanner:styles.detailPhoto}>{winnerBannerData(auction)?<WinnerBanner auction={auction}/>:<CatalogImage src={auction.product.images[0]?.path} alt={title}/>}</div>
   <h3 className={styles.title}>{title}</h3>
   {result?.publishedAt&&<p className={styles.date}><CalendarDays size={13} aria-hidden="true"/><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{formatAddisTimestamp(result.publishedAt,am?'am-ET':'en-GB')}</time></p>}
   {result?<AuctionResultSummary auction={auction}/>:<p className={styles.loading} role="status"><MiniPhrase en={auction.status==='cancelled'?'This auction was cancelled.':'Finalizing result'} am={auction.status==='cancelled'?'ይህ ጨረታ ተሰርዟል።':'ውጤቱ እየተጠናቀቀ ነው'}/></p>}
   {result&&<div ref={section} data-result-breakdown tabIndex={-1}>{visible?<Breakdown key={auction.code} code={auction.code}/>:<p className={styles.loading}><MiniPhrase en="Number breakdown" am="የቁጥሮች ዝርዝር"/></p>}</div>}
  </div>;
}
