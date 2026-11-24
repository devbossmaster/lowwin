'use client';
import type {RefObject} from 'react';
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
import ResultBreakdownContent from './result-sheet-content';
import {ResultRowsSkeleton} from './mini-route-skeleton';
import styles from './winner-results.module.css';

/** Opening the sheet starts the published breakdown in parallel with the summary. */
export default function ResultSheet({auction:initial,onClose,returnFocusRef}:{auction:CatalogAuction;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const {status,me,queryIdentity}=useTelegram();
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 return <AccountSheet title={<span className={styles.resultBadge}><Trophy size={13} aria-hidden="true"/><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></span>} onClose={onClose} returnFocusRef={returnFocusRef}><ResultSheetContent auction={initial}/></AccountSheet>;
}
/** Reuse the published-result surface inside an already-open auction sheet. */
export function ResultSheetContent({auction:initial}:{auction:CatalogAuction}){
 const {language}=useMiniLocale(),am=language==='am';
 const query=usePrivateQuery<CatalogAuction>('/api/results/'+encodeURIComponent(initial.code),{initialData:initial.result?.explanation?initial:undefined,freshnessMs:initial.result?.explanation?300000:15000});
 const stored=query.data?.result?query.data:initial,saved=stored.result,selected=initial.result;
 // The list may have refreshed its artwork since a previous sheet was opened.
 const result=saved?.source==='SETTLED'&&selected?.source==='SETTLED'&&saved.publishedAt===selected.publishedAt&&selected.winnerBannerVersion>saved.winnerBannerVersion
  ?{...saved,winnerBannerPath:selected.winnerBannerPath,winnerBannerVersion:selected.winnerBannerVersion,winnerPhotoPath:selected.winnerPhotoPath}
  :saved;
 const auction=result===saved?stored:{...stored,result};
 const title=am?auction.product.titleAm?.trim()||auction.product.title:auction.product.title;
 if(query.status!=='authenticated')return <PrivateState query={query}/>;
 return <div className={styles.resultSurface}>
   <div className={winnerBannerData(auction)?styles.detailBanner:styles.detailPhoto}>{winnerBannerData(auction)?<WinnerBanner auction={auction}/>:<CatalogImage src={auction.product.images[0]?.path} alt={title}/>}</div>
   <h3 className={styles.title}>{title}</h3>
   {result?.publishedAt&&<p className={styles.date}><CalendarDays size={13} aria-hidden="true"/><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{formatAddisTimestamp(result.publishedAt,am?'am-ET':'en-GB')}</time></p>}
   {result?<AuctionResultSummary auction={auction}/>:query.error?<PrivateState query={query}/>:!query.data?<ResultRowsSkeleton/>:<p className={styles.loading} role="status"><MiniPhrase en={auction.status==='cancelled'?'This auction was cancelled.':'Finalizing result'} am={auction.status==='cancelled'?'ይህ ጨረታ ተሰርዟል።':'ውጤቱ እየተጠናቀቀ ነው'}/></p>}
   {result?.source==='SETTLED'&&<div data-result-breakdown tabIndex={-1}><ResultBreakdownContent key={auction.code} code={auction.code}/></div>}
  </div>;
}
