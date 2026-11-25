'use client';
import {Phone} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatAuctionBid} from '@/lib/money';
import {maskPhoneDisplay} from '@/lib/phone-mask';
import {winnerResultExplanation} from '@/lib/winner-result-copy';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import trophy from './assets/winner-trophy.png';
import styles from './auction-result-summary.module.css';

export function AuctionResultSummary({auction,compact=false}:{auction:CatalogAuction;compact?:boolean}){
 const {language}=useMiniLocale(),am=language==='am';
 const {result}=auction;
 if(!result)return null;
 const winner=result.outcome==='WINNER';
 const phone=maskPhoneDisplay(result.winnerPhoneMasked);
 const identity=result.winnerDisplay||result.winnerUsername;
 const winnerName=identity||(result.source==='ILLUSTRATIVE'?<MiniPhrase en="Illustrative winner" am="የሙከራ አሸናፊ"/>:<MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/>);
 const Name=compact?'h2':'strong';
 const winningBid=winner&&result.winningPoints?formatAuctionBid(result.winningPoints,auction.terms.ruleVersion):null;
 const alternateDecision=result.decision==='FIRST_ACCEPTED_LOWEST';
 return <section className={styles.summary} data-compact={compact||undefined} data-winner={winner||undefined} data-testid={compact?'result-summary':undefined} aria-label={am?'የተረጋገጠ ውጤት':'Confirmed result'}>
  {winner?<>
   <div className={styles.winnerHeader}>
    <img className={styles.trophy} src={trophy.src} alt="" width={72} height={72} decoding="async"/>
    <div className={styles.identity}>
     <small><MiniPhrase en="Winner" am="አሸናፊ"/></small>
     <Name>{winnerName}</Name>
     {result.winnerUsername&&result.winnerDisplay&&<span>{result.winnerUsername}</span>}
     {phone&&<span className={styles.phone}><Phone size={12} aria-hidden="true"/><span dir="ltr">{phone}</span></span>}
    </div>
   </div>
   {(winningBid||!compact)&&<div className={styles.winningBid}>
    <div className={styles.bidCopy}>
     {winningBid&&<span className={styles.bidLabel}><MiniPhrase en="Winning bid" am="አሸናፊው ጨረታ"/></span>}
     {!compact&&<p className={styles.winningRule}><MiniPhrase en={alternateDecision?'The first bid at the lowest number won.':'The lowest unique bid wins.'} am={alternateDecision?'በዝቅተኛው ቁጥር የመጀመሪያው ጨረታ አሸንፏል።':'ዝቅተኛና ያልተደገመ ጨረታ ያሸንፋል።'}/></p>}
    </div>
    {winningBid&&<strong className={styles.winningNumber}>{winningBid}</strong>}
   </div>}
  </>:<>
   <div className={styles.identity}>{compact?<Name>{result.outcome==='NO_WINNER'?<MiniPhrase en="No winner" am="አሸናፊ የለም"/>:<MiniPhrase en="Auction cancelled" am="ጨረታው ተሰርዟል"/>}</Name>:<small><MiniPhrase en="Auction completed" am="ጨረታው ተጠናቋል"/></small>}</div>
   <p className={styles.selection}>{winnerResultExplanation(result,am)}</p>
   {!compact&&<p className={styles.summaryReference}><MiniPhrase en="Auction" am="ጨረታ"/> #{auction.code}</p>}
  </>}
  {compact&&(result.demoLabel||auction.isDemo)&&<p className={styles.summaryReference}>{result.demoLabel??'DEMO'} · <MiniPhrase en="No real prize" am="እውነተኛ ሽልማት የለም"/></p>}
 </section>;
}
