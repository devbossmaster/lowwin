'use client';
import {lazy,Suspense,useState} from 'react';
import {AccountSheet} from './account-sheet';
import {BidSheetPreview,type BidSheetAuction} from './bid-sheet-preview';
import {MiniPhrase} from './mini-locale';
import {useTelegram} from './telegram-provider';
import styles from './bid-payment-sheet.module.css';

const BidSheetContents=lazy(()=>import('./bid-sheet-content'));
export type {BidSheetAuction} from './bid-sheet-preview';
export type BidSheetPhase='entry'|'receipt'|'payment';
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;initialChapaId?:string};
export default function BidSheet(props:Props){const {queryIdentity}=useTelegram();return <BidSheetFrame key={`${queryIdentity??'guest'}:${props.auction.slug}:${props.initialChapaId??''}`} {...props}/>}
function BidSheetFrame(props:Props){
 const [phase,setPhase]=useState<BidSheetPhase>('entry');
 const title=phase==='receipt'?<MiniPhrase en="Bid receipt" am="የጨረታ ደረሰኝ"/>:phase==='payment'?<MiniPhrase en="Bid payment" am="የጨረታ ክፍያ"/>:<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>;
 return <AccountSheet size="payment" title={title} onClose={props.onClose} footerPortal>
  <Suspense fallback={<div className={styles.bidEntry}><BidSheetPreview auction={props.auction} showFee/><p role="status"><MiniPhrase en="Loading entry details…" am="የጨረታ ዝርዝሮችን በመጫን ላይ…"/></p></div>}><BidSheetContents {...props} onPhaseChange={setPhase}/></Suspense>
 </AccountSheet>;
}
