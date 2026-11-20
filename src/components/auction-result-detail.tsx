'use client';
import {CalendarDays} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {AuctionResultSummary} from './auction-result-summary';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-result-detail.module.css';

export function AuctionResultDetail({auction}:{auction:CatalogAuction}){
 const {language}=useMiniLocale();
 const {result}=auction;
 const end=result?.closedAt??auction.endsAt;
 return <>
  {result&&<AuctionResultSummary auction={auction} compact/>}
  <p className={styles.closedAt} data-testid={result?undefined:'result-summary'}>
   <CalendarDays size={14} aria-hidden="true"/>
   {auction.status==='cancelled'?<MiniPhrase en="Auction cancelled" am="ጨረታው ተሰርዟል"/>:<MiniPhrase en="Auction ended" am="ጨረታው ተጠናቋል"/>}
   <time dateTime={end}>{formatAddisTimestamp(end,language==='am'?'am-ET':'en-GB')}</time>
  </p>
 </>;
}
