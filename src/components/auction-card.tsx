'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowUpRight,Clock3} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {formatEtb} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
const BidSheet=dynamic(()=>import('./bid-sheet'));
export function AuctionCard({auction:initialAuction,serverNow}:{auction:CatalogAuction;serverNow?:string;onFavoriteChanged?:()=>void}){
 const [bidding,setBidding]=useState(false),ref=useRef<HTMLElement>(null);
 const {activity,refreshActivity}=useAuctionActivity(initialAuction.code,{element:ref,record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,startsAt:activity?.startsAt??initialAuction.startsAt,endsAt:activity?.endsAt??initialAuction.endsAt};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const detail=`/auctions/${auction.code}`,title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const statusText={live:am?'ክፍት':'Live',upcoming:am?'የሚመጣ':'Upcoming',closing:am?'ውጤት በመጠባበቅ':'Result pending',closed:am?'ተጠናቋል':'Completed',cancelled:am?'ተሰርዟል':'Cancelled'}[auction.status];
 return <article className="auction-card" ref={ref}>
  <Link className="auction-card-art" href={detail} aria-label={title}><CatalogImage src={auction.product.images[0]?.path} alt={title}/><span className={`status-tag status-${auction.status}`}>{statusText}</span>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}</Link>
  <div className="auction-card-body"><h3><Link href={detail}>{title}</Link></h3><div className="card-facts"><span className="card-fee"><MiniPhrase en="Fee" am="ክፍያ"/> <strong>{formatEtb(auction.terms.entryFeePoints)}</strong></span><span className="card-clock"><Clock3 size={13}/>{(live||upcoming)&&serverNow?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} onElapsed={refreshActivity}/>:statusText}</span></div>
   {live?<button className="primary-button card-action" onClick={()=>setBidding(true)}><MiniPhrase en="Bid now" am="አሁን ይጫረቱ"/><ArrowUpRight size={16}/></button>:<Link className="secondary-button card-action" href={detail}><MiniPhrase en={upcoming?'View auction':'View result'} am={upcoming?'ጨረታውን ይመልከቱ':'ውጤቱን ይመልከቱ'}/><ArrowUpRight size={16}/></Link>}
   <p className="card-caption"><MiniPhrase en={live?(isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee is non-refundable':'See auction terms'):'Scheduled'} am={live?(isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማስገቢያ ክፍያው ተመላሽ አይሆንም':'የጨረታ ውሎችን ይመልከቱ'):'የተወሰነ ጊዜ'}/> · {new Date(upcoming?auction.startsAt:auction.endsAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})} · <MiniPhrase en="Auction ID" am="የጨረታ መለያ"/> {auction.code}</p>
  </div>{bidding&&<BidSheet auction={auction} serverNow={serverNow??new Date().toISOString()} onClose={()=>setBidding(false)}/>}
 </article>;
}
