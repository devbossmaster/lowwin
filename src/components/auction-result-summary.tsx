'use client';
import {Phone} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAuctionBid} from '@/lib/money';
import {winnerResultExplanation} from '@/lib/winner-result-copy';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-result-summary.module.css';

export function AuctionResultSummary({auction,compact=false}:{auction:CatalogAuction;compact?:boolean}){
 const {language}=useMiniLocale(),am=language==='am';
 const {result}=auction;
 if(!result)return null;
 const winner=result.outcome==='WINNER';
 const identity=result.winnerDisplay||result.winnerUsername;
 const winnerName=identity||(result.source==='ILLUSTRATIVE'?<MiniPhrase en="Illustrative winner" am="የሙከራ አሸናፊ"/>:<MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/>);
 const Name=compact?'h2':'strong';
 return <section className={styles.summary} data-compact={compact||undefined} data-winner={winner||undefined} data-testid={compact?'result-summary':undefined} aria-label={am?'የተረጋገጠ ውጤት':'Confirmed result'}>
  {winner&&result.winningPoints&&<strong className={styles.winningNumber}>{formatAuctionBid(result.winningPoints,auction.terms.ruleVersion)}</strong>}
  <div className={styles.identity}>
   {winner?<>
    <small><MiniPhrase en="Winner" am="አሸናፊ"/></small>
    <Name>{winnerName}</Name>
    {result.winnerUsername&&result.winnerDisplay&&<span>{result.winnerUsername}</span>}
    {result.winnerPhoneMasked&&<span className={styles.phone}><Phone size={12} aria-hidden="true"/>{result.winnerPhoneMasked}</span>}
   </>:compact?<Name>{result.outcome==='NO_WINNER'?<MiniPhrase en="No winner" am="አሸናፊ የለም"/>:<MiniPhrase en="Auction cancelled" am="ጨረታው ተሰርዟል"/>}</Name>:<small><MiniPhrase en="Auction completed" am="ጨረታው ተጠናቋል"/></small>}
  </div>
  {(!compact||!winner)&&<p className={styles.selection}>{winnerResultExplanation(result,am)}</p>}
  {!compact&&<p className={styles.summaryReference}><MiniPhrase en="Auction" am="ጨረታ"/> #{auction.code}</p>}
  {compact&&(result.demoLabel||auction.isDemo)&&<p className={styles.summaryReference}>{result.demoLabel??'DEMO'} · <MiniPhrase en="No real prize" am="እውነተኛ ሽልማት የለም"/></p>}
 </section>;
}
