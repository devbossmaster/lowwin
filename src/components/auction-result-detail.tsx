'use client';
import {CalendarDays} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-result-detail.module.css';

export function AuctionResultDetail({auction}:{auction:CatalogAuction}){
 const {language}=useMiniLocale();
 const end=auction.endsAt;
 return <p className={styles.closedAt} data-testid="result-summary">
   <CalendarDays size={14} aria-hidden="true"/>
   {auction.status==='cancelled'?<MiniPhrase en="Auction cancelled" am="ጨረታው ተሰርዟል"/>:auction.status==='closing'?<MiniPhrase en="Finalizing result" am="ውጤቱ እየተጠናቀቀ ነው"/>:<MiniPhrase en="Auction ended" am="ጨረታው ተጠናቋል"/>}
   <time dateTime={end}>{formatAddisTimestamp(end,language==='am'?'am-ET':'en-GB')}</time>
  </p>;
}
