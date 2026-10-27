'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Clock3,Ticket} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {AuctionCountdown} from './auction-countdown';
import {etbToCents,formatEtb} from '@/lib/money';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import BidSheet from './bid-sheet';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
import {seedAuctionQuery} from './auction-query';
export function AuctionCard({auction:initialAuction,serverNow,serverObservedAt,priority=false}:{auction:CatalogAuction;serverNow?:string;serverObservedAt?:number;priority?:boolean;onFavoriteChanged?:()=>void}){
 const [bidding,setBidding]=useState(false),ref=useRef<HTMLElement>(null);
 const {queryIdentity}=useTelegram();
 useEffect(()=>seedAuctionQuery(queryIdentity,initialAuction),[queryIdentity,initialAuction]);
 const warmBid=()=>prefetchAuctionIntent(queryIdentity,initialAuction.slug);
 const {activity,refreshActivity}=useAuctionActivity(initialAuction.code,{element:ref,record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,startsAt:activity?.startsAt??initialAuction.startsAt,endsAt:activity?.endsAt??initialAuction.endsAt,bidCount:activity?.bids??initialAuction.bidCount};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const detail=`/auctions/${auction.code}`,title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const statusText={live:am?'ክፍት':'Live',upcoming:am?'የሚመጣ':'Upcoming',closing:am?'ውጤት በመጠባበቅ':'Result pending',closed:am?'ተጠናቋል':'Completed',cancelled:am?'ተሰርዟል':'Cancelled'}[auction.status];
 const fee=formatEtb(auction.terms.entryFeePoints),hasFee=etbToCents(auction.terms.entryFeePoints)>0n;
 return <article className="auction-card" ref={ref}>
  <IntentPrefetchLink className="auction-card-art" href={detail} aria-label={title}><CatalogImage src={auction.product.images[0]?.path} alt={title} priority={priority}/><span className={`status-tag status-${auction.status}`}>{statusText}</span>{auction.isDemo&&<span className="demo-ribbon">DEMO</span>}{(live||upcoming)&&<span className="auction-card-win"><MiniPhrase en="Win" am="ያሸንፉ"/></span>}</IntentPrefetchLink>
  <div className="auction-card-body"><h3><IntentPrefetchLink href={detail}>{title}</IntentPrefetchLink></h3><div className="card-facts"><span className="card-fee"><MiniPhrase en="Fee" am="ክፍያ"/> <strong>{fee}</strong></span><span className="card-clock"><Clock3 size={13} aria-hidden="true"/>{(live||upcoming)&&serverNow?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} observedAt={serverObservedAt} label={upcoming?'Starts':'Ends'} showLabel={false} onElapsed={refreshActivity}/>:statusText}</span></div>
   {live?<button className="primary-button card-action" onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><Ticket size={16} aria-hidden="true"/><MiniPhrase en={hasFee?`Pay ${fee} & bid`:'Bid now'} am={hasFee?`${fee} ከፍለው ይጫረቱ`:'አሁን ይጫረቱ'}/></button>:<IntentPrefetchLink className="secondary-button card-action" href={detail}><MiniPhrase en={upcoming?'View auction':'View result'} am={upcoming?'ጨረታውን ይመልከቱ':'ውጤቱን ይመልከቱ'}/><ArrowUpRight size={16} aria-hidden="true"/></IntentPrefetchLink>}
   <p className="card-disclosure"><MiniPhrase en={hasFee?(isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee is non-refundable':'See auction terms'):'No entry fee'} am={hasFee?(isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማስገቢያ ክፍያው ተመላሽ አይሆንም':'የጨረታ ውሎችን ይመልከቱ'):'የመግቢያ ክፍያ የለም'}/></p>
   <p className="card-caption"><span><MiniPhrase en={upcoming?'Starts':live?'Closes':'Scheduled close'} am={upcoming?'የሚጀምረው':live?'የሚዘጋው':'የመዝጊያ ጊዜ'}/> · <time dateTime={upcoming?auction.startsAt:auction.endsAt}>{new Date(upcoming?auction.startsAt:auction.endsAt).toLocaleString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Africa/Addis_Ababa'})}</time></span><span>· <MiniPhrase en="Auction ID" am="የጨረታ መለያ"/> {auction.code}</span></p>
  </div>{bidding&&<BidSheet auction={auction} serverNow={serverNow??new Date().toISOString()} onClose={()=>setBidding(false)}/>}
 </article>;
}
