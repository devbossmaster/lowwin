'use client';
import type {RefObject} from 'react';
import {CalendarDays,Trophy} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import type {PersonalBidListItem} from '@/modules/profile/bid-list';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {AccountSheet} from './account-sheet';
import {AuctionResultSummary} from './auction-result-summary';
import {CatalogImage} from './catalog-image';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {WinnerBanner,winnerBannerData} from './winner-banner';
import {WinnerCelebration} from './celebration';
import {PrivateState,usePrivateQuery} from './private-query';
import {useTelegram} from './telegram-provider';
import ResultBreakdownContent from './result-sheet-content';
import {ResultRowsSkeleton} from './mini-route-skeleton';
import {resultQueryUrl} from './result-query';
import styles from './winner-results.module.css';

/** Opening the sheet starts the published breakdown in parallel with the summary. */
export default function ResultSheet({auction:initial,onClose,returnFocusRef}:{auction:CatalogAuction;onClose:()=>void;returnFocusRef?:RefObject<HTMLElement|null>}){
 const {status,me,queryIdentity}=useTelegram();
 if(status!=='authenticated'||!me?.user?.id||!queryIdentity)return null;
 return <AccountSheet title={<span className={styles.resultBadge}><Trophy size={13} aria-hidden="true"/><MiniPhrase en="Auction result" am="የጨረታ ውጤት"/></span>} onClose={onClose} returnFocusRef={returnFocusRef}><ResultSheetContent auction={initial}/></AccountSheet>;
}
/** Reuse the published-result surface inside an already-open auction sheet. */
export function ResultSheetContent(props:{auction:CatalogAuction}|{preview:PersonalBidListItem['auction']}){
 const {language}=useMiniLocale(),am=language==='am';
 const code=('auction' in props?props.auction:props.preview).code;
 const initial='auction' in props?props.auction:undefined,preview='preview' in props?props.preview:undefined;
 const initialData=initial?.result?.explanation?initial:undefined;
 const query=usePrivateQuery<CatalogAuction>(resultQueryUrl(code),{initialData,freshnessMs:initialData?300000:15000,cancelOnUnmount:!!preview});
 const stored=query.data?.result?query.data:initial??query.data,saved=stored?.result,selected=initial?.result;
 // The list may have refreshed its artwork since a previous sheet was opened.
 const result=saved?.source==='SETTLED'&&selected?.source==='SETTLED'&&saved.publishedAt===selected.publishedAt&&selected.winnerBannerVersion>saved.winnerBannerVersion
  ?{...saved,winnerBannerPath:selected.winnerBannerPath,winnerBannerVersion:selected.winnerBannerVersion,winnerPhotoPath:selected.winnerPhotoPath}
  :saved;
 const auction=stored&&result!==saved?{...stored,result:result??null}:stored;
 const title=auction?.product.title??preview?.title??code;
 const label=am?(auction?.product.titleAm??preview?.titleAm)?.trim()||title:title;
 const image=auction?.product.images[0]?.path;
 const banner=auction&&winnerBannerData(auction);
 if(query.status!=='authenticated')return <PrivateState query={query}/>;
 return <div className={styles.resultSurface}>
   <div className={styles.resultHero}>
    <div className={banner?styles.detailBanner:styles.detailPhoto} data-result-art-placeholder={!auction||undefined} aria-hidden={!auction||undefined}>
     {banner&&auction?<WinnerBanner auction={auction} eager/>:auction?<CatalogImage src={image} alt={label} eager/>:null}
    </div>
    <h3 className={styles.title}>{label}</h3>
    {result?.publishedAt&&<p className={styles.date}><CalendarDays size={13} aria-hidden="true"/><MiniPhrase en="Announced" am="የታወጀው"/> <time dateTime={result.publishedAt}>{formatAddisTimestamp(result.publishedAt,am?'am-ET':'en-GB')}</time></p>}
    {result?.source==='SETTLED'&&result.outcome==='WINNER'&&<WinnerCelebration id={`${code}:${result.publishedAt}`}/>}
   </div>
   {result&&auction?<AuctionResultSummary auction={auction}/>:query.error?<PrivateState query={query}/>:!query.data?<ResultRowsSkeleton/>:<p className={styles.loading} role="status"><MiniPhrase en={auction?.status==='cancelled'?'This auction was cancelled.':'Finalizing result'} am={auction?.status==='cancelled'?'ይህ ጨረታ ተሰርዟል።':'ውጤቱ እየተጠናቀቀ ነው'}/></p>}
   {result?.source==='SETTLED'&&<div data-result-breakdown tabIndex={-1}><ResultBreakdownContent key={code} code={code}/></div>}
  </div>;
}
