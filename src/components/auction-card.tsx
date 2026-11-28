'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,Clock3,Eye,ShieldCheck,Ticket} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {CatalogImage} from './catalog-image';
import {homeAuctionImageSizes} from '@/lib/media-renditions';
import {AuctionCountdown} from './auction-countdown';
import {etbToCents,formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import BidSheet from './bid-sheet';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
import {seedAuctionQuery} from './auction-query';
import {AuctionShare} from './auction-share';
import badges from './auction-card-badges.module.css';
export function AuctionCard({auction:initialAuction,serverNow,serverObservedAt,priority=false,homeCard=false}:{auction:CatalogAuction;serverNow?:string;serverObservedAt?:number;priority?:boolean;homeCard?:boolean;onFavoriteChanged?:()=>void}){
 const [bidding,setBidding]=useState(false),ref=useRef<HTMLElement>(null);
 const {queryIdentity}=useTelegram();
 useEffect(()=>seedAuctionQuery(queryIdentity,initialAuction),[queryIdentity,initialAuction]);
 const warmBid=()=>prefetchAuctionIntent(queryIdentity,initialAuction.slug);
 const {activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{element:ref,record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,startsAt:activity?.startsAt??initialAuction.startsAt,endsAt:activity?.endsAt??initialAuction.endsAt,bidCount:activity?.bids??initialAuction.bidCount};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const publishedResult=(auction.status==='closed'||auction.status==='cancelled')&&(activity?.resultReady||initialAuction.result);
 const detail=publishedResult?`/winners/${auction.code}`:`/auctions/${auction.code}`,title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const statusText={live:am?'ክፍት':'Live',upcoming:am?'የሚመጣ':'Upcoming',closing:am?'ውጤት በመጠባበቅ':'Result pending',closed:am?'ተጠናቋል':'Completed',cancelled:am?'ተሰርዟል':'Cancelled'}[auction.status];
 const fee=formatEtb(auction.terms.entryFeePoints),hasFee=etbToCents(auction.terms.entryFeePoints)>0n;
 const bidCount=Number.isSafeInteger(auction.bidCount)&&auction.bidCount>=0?auction.bidCount:null;
 const bidLabel=bidCount===null?'—':bidCount.toLocaleString(am?'am-ET':'en-ET');
 const recordedViews=views??initialAuction.viewCount;
 let viewLabel='—';try{if(/^\d+$/.test(recordedViews))viewLabel=BigInt(recordedViews).toLocaleString(am?'am-ET':'en-ET')}catch{}
 const countdown=(live||upcoming)&&serverNow?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} observedAt={serverObservedAt} label={upcoming?'Starts':'Ends'} showLabel={false} onElapsed={refreshActivity}/>:null;
 const homeClock=homeCard&&countdown!==null;
 const termsNote=<><ShieldCheck size={13} aria-hidden="true"/><MiniPhrase en="Terms & conditions apply" am="ውሎችና ሁኔታዎች ይተገበራሉ"/></>;
 return <article className={`auction-card ${badges.card}${homeCard?' '+badges.homeCard:''}`} ref={ref}>
  <IntentPrefetchLink className="auction-card-art" href={detail} aria-label={title}>
   <CatalogImage src={auction.product.images[0]?.path} alt={title} priority={priority} sizes={homeCard?homeAuctionImageSizes:undefined}/>
   <span className={`status-tag status-${auction.status}`}>{statusText}</span>
   <span className={badges.views} aria-label={am?`${viewLabel} የተመዘገቡ እይታዎች`:`${viewLabel} recorded views`}><Eye size={13} aria-hidden="true"/><span className={badges.count}>{viewLabel}</span></span>
   {auction.isDemo&&<span className="demo-ribbon">DEMO</span>}
   {(live||upcoming)&&<span className="auction-card-win"><MiniPhrase en="Win" am="ያሸንፉ"/></span>}
  </IntentPrefetchLink>
  <div className="auction-card-body">
   <h3><IntentPrefetchLink href={detail}>{title}</IntentPrefetchLink></h3>
   <div className={homeClock?`card-facts ${badges.homeFacts}`:'card-facts'}>
    <span className="card-fee"><MiniPhrase en="Fee" am="ክፍያ"/> <strong>{fee}</strong></span>
    <span className={badges.bids} data-card-bid-count={bidCount??'unavailable'} data-long-bid-count={homeClock&&bidLabel.length>5||undefined} aria-label={bidCount===null?(am?'የጨረታ ብዛት አልተገኘም':'Bid count unavailable'):(am?`${bidLabel} ጠቅላላ ጨረታዎች`:`${bidLabel} total bids`)}>
     <Ticket size={12} aria-hidden="true"/><strong>{bidLabel}</strong><span><MiniPhrase en="bids" am="ጨረታ"/></span>
    </span>
    <span className={homeClock?`card-clock ${badges.homeClock}`:'card-clock'}>
     {homeClock?<span className={badges.clockTitle}>
      <MiniPhrase en={upcoming?'Starts in':'Ends in'} am={upcoming?'የሚጀምረው በ':'ቀሪ ጊዜ'}/>
     </span>:<Clock3 size={13} aria-hidden="true"/>}
     {countdown??statusText}
    </span>
   </div>
   {live?<button type="button" className={`primary-button card-action ${badges.placeBid}`} onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><MiniPhrase en="Place a bid" am="ይጫረቱ"/><ArrowRight size={17} aria-hidden="true"/></button>:<IntentPrefetchLink className="secondary-button card-action" href={detail}><MiniPhrase en={upcoming?'View auction':'View result'} am={upcoming?'ጨረታውን ይመልከቱ':'ውጤቱን ይመልከቱ'}/><ArrowUpRight size={16} aria-hidden="true"/></IntentPrefetchLink>}
   <div className={badges.utilities}>
    {homeCard?<span className={badges.terms}>{termsNote}</span>:<IntentPrefetchLink href="/terms" className={badges.terms}>{termsNote}</IntentPrefetchLink>}
    <AuctionShare title={title} code={auction.code} className={badges.share}/>
   </div>
   <p className="card-disclosure"><MiniPhrase en={hasFee?(auction.terms.ruleVersion==='lowest-unique-v5'?'Cancelled auction? Paid fees return to your wallet':isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee is non-refundable':'See auction terms'):'No entry fee'} am={hasFee?(auction.terms.ruleVersion==='lowest-unique-v5'?'ጨረታ ሲሰረዝ የተከፈለው ክፍያ ወደ ዋሌትዎ ይመለሳል':isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማስገቢያ ክፍያው ተመላሽ አይሆንም':'የጨረታ ውሎችን ይመልከቱ'):'የመግቢያ ክፍያ የለም'}/></p>
   <p className="card-caption"><span><MiniPhrase en={upcoming?'Starts':live?'Closes':'Scheduled close'} am={upcoming?'የሚጀምረው':live?'የሚዘጋው':'የመዝጊያ ጊዜ'}/> · <time dateTime={upcoming?auction.startsAt:auction.endsAt}>{formatAddisTimestamp(upcoming?auction.startsAt:auction.endsAt,am?'am-ET':'en-GB')}</time></span><span>· <MiniPhrase en="Auction ID" am="የጨረታ መለያ"/> {auction.code}</span></p>
  </div>{bidding&&<BidSheet auction={auction} serverNow={serverNow??new Date().toISOString()} onClose={()=>setBidding(false)}/>}
 </article>;
}
