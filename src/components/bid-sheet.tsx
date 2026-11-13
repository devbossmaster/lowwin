'use client';
import {useCallback,useState} from 'react';
import {Wallet} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import type {BidSheetAuction} from './bid-sheet-preview';
import BidSheetContents from './bid-sheet-content';
import {MiniPhrase} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {AuctionShare} from './auction-share';
import styles from './bid-payment-sheet.module.css';

export type {BidSheetAuction} from './bid-sheet-preview';
export type BidSheetPhase='entry'|'review'|'checkout'|'topup'|'receipt'|'payment';
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
 const [back,setBack]=useState<(()=>void)|null>(null),onDismissChange=useCallback((handler:(()=>void)|null)=>{setBack(()=>handler)},[]);
 const title=phase==='receipt'?<MiniPhrase en="Bid receipt" am="የጨረታ ደረሰኝ"/>:phase==='topup'?<span><Wallet size={18} aria-hidden="true"/><MiniPhrase en="Top up wallet" am="ገንዘብ ያስገቡ"/></span>:phase==='checkout'?<MiniPhrase en="Pay securely" am="ይክፈሉ"/>:phase==='payment'?<MiniPhrase en="Payment" am="ክፍያ"/>:phase==='review'?<MiniPhrase en="Review bids" am="ጨረታዎችን ይመልከቱ"/>:<MiniPhrase en="Place your bid" am="ጨረታዎን ያቅርቡ"/>;
 return <AccountSheet size="payment" layout={phase==='entry'?'bid-reference':phase==='topup'?'topup-reference':'bid-entry'} presentation={phase==='payment'||phase==='receipt'?'centered':undefined} title={phase==='entry'?<><span className="sr-only">{title}</span><span className={styles.headerStatus}><MiniPhrase en={props.auction.status==='live'?'Live':props.auction.status==='upcoming'?'Upcoming':'Completed'} am={props.auction.status==='live'?'ቀጥታ':props.auction.status==='upcoming'?'በቅርብ':'ተጠናቋል'}/></span></>:title} headerActions={phase==='entry'?<AuctionShare title={props.auction.product.title} code={props.auction.slug} iconOnly/>:undefined} onClose={props.onClose} onBack={back??undefined} footerPortal>
  <BidSheetContents {...props} onPhaseChange={setPhase} onDismissChange={onDismissChange}/>
 </AccountSheet>;
}
