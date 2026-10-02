'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Check,Copy,Eye,Gavel,Tag,Trophy} from 'lucide-react';
import {CatalogImage} from './catalog-image';
import {useMiniLocale} from './mini-locale';
import {formatEtb} from '@/lib/money';
import {bidTicket} from '@/lib/bid-ticket';
import {useAuctionActivity} from './auction-activity';
import styles from '@/app/(mini)/my-bids/my-bids.module.css';

type PersonalBid={bidId:string|null;amount:string;code:string;title:string;titleAm?:string|null;image:{path:string;alt:string}|null;views:string;isDemo:boolean;outcome:string};
export function PersonalBidCard({item,onSettled}:{item:PersonalBid;onSettled?:()=>void}){
  const {language}=useMiniLocale(),am=language==='am';
  const [copyState,setCopyState]=useState<'idle'|'copied'|'error'>('idle');
  const ref=useRef<HTMLElement>(null),notified=useRef(false);
  const {activity,views}=useAuctionActivity(item.code,{element:ref,record:true});
  useEffect(()=>{if(activity?.resultReady&&['LIVE','PENDING'].includes(item.outcome)&&!notified.current){notified.current=true;onSettled?.()}},[activity?.resultReady,item.outcome,onSettled]);
  const title=am?(item.titleAm?.trim()||item.title):item.title;
  const live=item.outcome==='LIVE'&&(!activity||activity.status==='live'||activity.status==='upcoming'),won=item.outcome==='WON';
  const status=live?(am?'በሂደት ላይ':'Live'):won?(am?'አሸናፊ':'Won'):item.outcome==='LOST'?(am?'አላሸነፈም':'Not won'):item.outcome==='CANCELLED'?(am?'ተሰርዟል':'Cancelled'):['LIVE','PENDING'].includes(item.outcome)?(am?'ጨረታው አብቋል':'Ended'):(am?'አሸናፊ የለም':'No winner');
  const ticket=item.bidId?bidTicket(item.bidId):null;
  async function copy(){
    if(!ticket)return;
    try{await navigator.clipboard.writeText(ticket);setCopyState('copied')}catch{setCopyState('error')}
  }
  return <article className={`${styles.card} personal-bid-card`} ref={ref}>
    <Link className={styles.cardLink} href={`/auctions/${item.code}`} aria-label={`${am?'የጨረታ ዝርዝር':'View auction'}: ${title}, ${am?'የእርስዎ ጨረታ':'your bid'} ${formatEtb(item.amount)}`}/>
    <div className={styles.visual}>
      <CatalogImage src={item.image?.path} alt={item.image?.alt??title}/>
      <span className={`${styles.status} ${live?styles.live:won?styles.won:styles.closed}`}>{status}</span>
      <span className={styles.views} aria-label={`${views??item.views} ${am?'እይታዎች':'views'}`}><Eye size={18} aria-hidden="true"/>{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(BigInt(views??item.views))}</span>
      {ticket&&<button type="button" className={styles.ticket} onClick={()=>void copy()} aria-label={`${am?'የጨረታ ትኬት ቅዳ':'Copy bid ticket'} ${ticket}`}><Gavel size={15} aria-hidden="true"/><span>{ticket}</span>{copyState==='copied'?<Check size={16} aria-hidden="true"/>:<Copy size={16} aria-hidden="true"/>}</button>}
      <span className={styles.bidIcon}>{won?<Trophy size={21}/>:<Gavel size={21}/>}</span>
      {item.isDemo&&<span className={styles.demo}>DEMO</span>}
    </div>
    <div className={styles.body}><h2>{title}</h2><div className={styles.facts}>
      <div><Gavel size={28} aria-hidden="true"/><span><small>{won?(am?'ያሸነፈው መጠን':'Winning amount'):(am?'የጨረታ መጠን':'Bid amount')}</small><strong>{formatEtb(item.amount)}</strong></span></div>
      <div><Tag size={28} aria-hidden="true"/><span><small>{am?'የጨረታ ኮድ':'Auction code'}</small><strong>{item.code}</strong></span></div>
    </div><p className={`${styles.outcome} ${won?styles.outcomeWon:''}`}>{status}</p>
    {copyState!=='idle'&&<p role="status" className={styles.copyNotice}>{copyState==='copied'?(am?'ትኬቱ ተቀድቷል':'Ticket copied'):(am?'ቅዳ አልተቻለም። ትኬቱን ይምረጡና ይቅዱ።':'Could not copy. Select the ticket text to copy it.')}</p>}
    </div>
  </article>;
}
