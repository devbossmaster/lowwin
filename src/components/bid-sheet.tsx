'use client';
import {useState} from 'react';
import {AccountSheet} from './account-sheet';
import type {BidSheetAuction} from './bid-sheet-preview';
import BidSheetContents from './bid-sheet-content';
import {MiniPhrase} from './mini-locale';
import {useTelegram} from './telegram-provider';

export type {BidSheetAuction} from './bid-sheet-preview';
export type BidSheetPhase='entry'|'receipt'|'payment';
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;initialChapaId?:string};
export default function BidSheet(props:Props){const {queryIdentity}=useTelegram();return <BidSheetFrame key={`${queryIdentity??'guest'}:${props.auction.slug}:${props.initialChapaId??''}`} {...props}/>}
function BidSheetFrame(props:Props){
 const [phase,setPhase]=useState<BidSheetPhase>(props.initialChapaId?'payment':'entry');
 const title=phase==='receipt'?<MiniPhrase en="Bid receipt" am="የጨረታ ደረሰኝ"/>:phase==='payment'?<MiniPhrase en="Bid payment" am="የጨረታ ክፍያ"/>:<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>;
 return <AccountSheet size="payment" title={title} onClose={props.onClose} footerPortal>
  <BidSheetContents {...props} onPhaseChange={setPhase}/>
 </AccountSheet>;
}
