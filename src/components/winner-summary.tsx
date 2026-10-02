'use client';
import {Coins,Phone,UserRound} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {useMiniLocale} from './mini-locale';
import styles from './winners-page.module.css';

export function WinnerSummary({auction}:{auction:CatalogAuction}){
  const {language}=useMiniLocale(),am=language==='am',result=auction.result;
  if(result?.outcome!=='WINNER')return <p className={styles.outcomeText}>{!result?(am?'ጨረታው አብቋል':'Auction ended'):result.outcome==='NO_WINNER'?(am?'አሸናፊ የለም':'No winner'):(am?'ጨረታው ተሰርዟል':'Auction cancelled')}</p>;
  return <dl className={styles.winnerDetails}>
    <div><dt><UserRound size={18}/><span>{am?'አሸናፊ':'Winner'}</span></dt><dd>{result.winnerDisplay||(result.source==='ILLUSTRATIVE'?(am?'የሙከራ አሸናፊ':'Illustrative winner'):(am?'አሸናፊ':'Winner'))}</dd></div>
    <div><dt><Coins size={18}/><span>{am?'ያሸነፈው መጠን':'Winning amount'}</span></dt><dd className={styles.winningAmount}>{result.winningPoints?formatEtb(result.winningPoints):'—'}</dd></div>
    <div><dt><Phone size={18}/><span>{am?'ስልክ':'Phone'}</span></dt><dd>{result.winnerPhoneMasked??'—'}</dd></div>
  </dl>;
}
