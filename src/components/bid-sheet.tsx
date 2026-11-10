'use client';
import {useCallback,useRef,useState} from 'react';
import {AccountSheet} from './account-sheet';
import type {BidSheetAuction} from './bid-sheet-preview';
import BidSheetContents from './bid-sheet-content';
import {MiniPhrase} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {AuctionShare} from './auction-share';
import styles from './bid-payment-sheet.module.css';

export type {BidSheetAuction} from './bid-sheet-preview';
export type BidSheetPhase='entry'|'review'|'receipt'|'payment';
type Props={auction:BidSheetAuction;serverNow:string;onClose:()=>void;initialChapaId?:string;initialDraft?:import('./bid-sheet-content').BidCheckoutDraft};
export default function BidSheet(props:Props){
 const {queryIdentity}=useTelegram(),[owner,setOwner]=useState({identity:queryIdentity,generation:0});
 const generation=owner.generation+(owner.identity&&owner.identity!==queryIdentity?1:0);
 if(owner.identity!==queryIdentity)setOwner({identity:queryIdentity,generation});
 // Registration preserves the anonymous draft; logout or an account switch
 // discards anything belonging to the previous signed-in account.
 return <BidSheetFrame key={`${generation}:${props.auction.slug}:${props.initialChapaId??''}`} {...props}/>;
}
function BidSheetFrame(props:Props){
 const [phase,setPhase]=useState<BidSheetPhase>(props.initialChapaId?'payment':'entry');
 const dismiss=useRef<(()=>void)|null>(null),onDismissChange=useCallback((handler:(()=>void)|null)=>{dismiss.current=handler},[]);
 const title=phase==='receipt'?<MiniPhrase en="Bid receipt" am="የጨረታ ደረሰኝ"/>:phase==='payment'||phase==='review'?<MiniPhrase en="Payment" am="ክፍያ"/>:<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>;
 return <AccountSheet size="payment" layout="bid-entry" presentation={phase==='payment'||phase==='receipt'?'centered':undefined} title={<>{title}{phase==='entry'&&<span className={styles.headerStatus} aria-hidden="true"><MiniPhrase en={props.auction.status==='live'?'Live':props.auction.status==='upcoming'?'Upcoming':'Completed'} am={props.auction.status==='live'?'ቀጥታ':props.auction.status==='upcoming'?'በቅርብ':'ተጠናቋል'}/></span>}</>} headerActions={phase==='entry'?<AuctionShare title={props.auction.product.title} code={props.auction.slug} iconOnly/>:undefined} onClose={()=>dismiss.current?dismiss.current():props.onClose()} footerPortal>
  <BidSheetContents {...props} onPhaseChange={setPhase} onDismissChange={onDismissChange}/>
 </AccountSheet>;
}
