'use client';
import {useState} from 'react';
import {AccountSheet} from './account-sheet';
import type {BidSheetAuction} from './bid-sheet-preview';
import BidSheetContents from './bid-sheet-content';
import {MiniPhrase} from './mini-locale';
import {useTelegram} from './telegram-provider';
import styles from './bid-payment-sheet.module.css';

export type {BidSheetAuction} from './bid-sheet-preview';
export type BidSheetPhase='entry'|'receipt'|'payment';
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;initialChapaId?:string};
export default function BidSheet(props:Props){const {queryIdentity}=useTelegram();return <BidSheetFrame key={`${queryIdentity??'guest'}:${props.auction.slug}:${props.initialChapaId??''}`} {...props}/>}
function BidSheetFrame(props:Props){
 const [phase,setPhase]=useState<BidSheetPhase>(props.initialChapaId?'payment':'entry');
 const title=phase==='receipt'?<MiniPhrase en="Bid receipt" am="የጨረታ ደረሰኝ"/>:phase==='payment'?<MiniPhrase en="Bid payment" am="የጨረታ ክፍያ"/>:<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>;
 return <AccountSheet size="payment" layout={phase==='entry'?'bid-entry':undefined} title={<>{title}{phase==='entry'&&<span className={styles.headerStatus} aria-hidden="true"><MiniPhrase en={props.auction.status==='live'?'Live':props.auction.status==='upcoming'?'Upcoming':'Completed'} am={props.auction.status==='live'?'ቀጥታ':props.auction.status==='upcoming'?'በቅርብ':'ተጠናቋል'}/></span>}</>} onClose={props.onClose} footerPortal>
  <BidSheetContents {...props} onPhaseChange={setPhase}/>
 </AccountSheet>;
}
