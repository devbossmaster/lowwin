'use client';
import Link from 'next/link';
import BidSheet from './bid-sheet';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {chapaUuid} from '@/lib/chapa-client';
import {ArrowRight,Clock3,Eye,Gavel,Hash,Ticket} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {AuctionGallery} from './auction-gallery';
import {AuctionResultDetail} from './auction-result-detail';
import {AuctionMoreChances} from './auction-more-chances';
import {ProductDescription} from './product-description';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShareOptions} from './auction-share';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
const ArifPayReturn=dynamic(()=>import('./arifpay-return').then(module=>module.ArifPayReturn));
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-detail.module.css';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import {auctionDetailUrl} from './auction-query';
import {usePrivateQuery} from './private-query';
import {auctionPresentationRefreshVersion} from '@/lib/auction-presentation-refresh';
import {Button} from './ui/button';
import {Card} from './ui/card';

export function AuctionDetail({auction:initialAuction,serverNow,publishedResult=false}:{auction:CatalogAuction;serverNow:string;publishedResult?:boolean}){
 const detail=usePrivateQuery<CatalogAuction>(auctionDetailUrl(initialAuction.slug),{initialData:initialAuction});
 const known=detail.data??initialAuction;
 const params=useSearchParams(),candidate=params.get('chapa'),chapaId=params.getAll('chapa').length===1&&candidate&&chapaUuid.test(candidate)?candidate:undefined;
 const checkout=params.get('checkout'),legacyReturn=params.getAll('checkout').length===1&&checkout&&chapaUuid.test(checkout);
 const [bidding,setBidding]=useState(!!chapaId),[returnId,setReturnId]=useState(chapaId);
 const router=useRouter(),{queryIdentity}=useTelegram();
 const warmBid=()=>prefetchAuctionIntent(queryIdentity,initialAuction.slug);
 useEffect(()=>{if(initialAuction.status==='live'&&window.location.hash==='#bid-review')setBidding(true)},[initialAuction.status]);
 useEffect(()=>{if(chapaId){setReturnId(chapaId);setBidding(true)}},[chapaId]);
 const closeBidding=()=>{
  setBidding(false);setReturnId(undefined);
  const url=new URL(window.location.href);
  url.searchParams.delete('chapa');
  if(url.hash==='#bid-review')url.hash='';
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  if(publishedResult)router.replace(`/winners/${initialAuction.code}`);
 };
 const {activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{record:true});
 const presentationRequest=useRef({code:initialAuction.code,version:0});
 useEffect(()=>{
  if(presentationRequest.current.code!==initialAuction.code)presentationRequest.current={code:initialAuction.code,version:0};
  const revision=auctionPresentationRefreshVersion(known.presentationVersion,activity?.presentationVersion,presentationRequest.current.version);
  if(revision===null)return;
  presentationRequest.current.version=revision;detail.reload();
 },[initialAuction.code,known.presentationVersion,activity?.presentationVersion,detail.reload]);
 useAuctionRefresh(bidding?null:activity,initialAuction.status,publishedResult);
 const auction={...known,status:activity?.status??initialAuction.status,viewCount:views??known.viewCount,bidCount:activity?.bids??known.bidCount,startsAt:activity?.startsAt??known.startsAt,endsAt:activity?.endsAt??known.endsAt};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const ended=['closed','cancelled','closing'].includes(auction.status);
 const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const date=(value:string)=>formatAddisTimestamp(value,am?'am-ET':'en-GB');
 const statusLabels={live:['Live','ክፍት'],upcoming:['Upcoming','የሚመጣ'],closing:['Result pending','ውጤት በመጠባበቅ'],cancelled:['Cancelled','ተሰርዟል'],closed:['Closed','ተዘግቷል']} as const;
 const [statusEn,statusAm]=statusLabels[auction.status];
 const target=upcoming?auction.startsAt:auction.endsAt;
 const activityLabel=am?'የጨረታው እንቅስቃሴ':'Auction activity';
 const counts=<div className={styles.numbers}>
  <div><Gavel size={14} aria-hidden="true"/><span><strong>{auction.result?.source==='ILLUSTRATIVE'?'—':auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div>
  <div><Eye size={14} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div>
 </div>;
 return <article className={styles.page} data-auction-detail data-auction-live={live||undefined}>
  {legacyReturn&&<ArifPayReturn auctionSlug={auction.slug}/>}
  <div className={styles.content}>
  <Card className={styles.overview}>
   <div data-auction-hero>
    <AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo} priority sizes="(max-width: 460px) 100vw, 460px" status={<span className={styles.status}><i aria-hidden="true"/><MiniPhrase en={statusEn} am={statusAm}/></span>}/>
   </div>
   <header className={styles.intro}>
    <h1>{title}</h1>
    <div className={styles.auctionMeta}>
     <dl className={styles.purchaseFacts} data-auction-facts>
      <div className={styles.fee}><dt><Ticket size={13} aria-hidden="true"/><MiniPhrase en="Fee per bid" am="የአንድ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div>
      <div><dt><Hash size={13} aria-hidden="true"/><MiniPhrase en="Auction code" am="የጨረታ ኮድ"/></dt><dd>{auction.code}</dd></div>
     </dl>
     <Link className={styles.category} href={`/?category=${encodeURIComponent(auction.category.slug)}#discover-auctions`}><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></Link>
    </div>
   </header>
   {!ended&&<section className={styles.stats} aria-label={activityLabel}>
    <div className={styles.countdownPanel}>
     <div className={styles.timerHeading}>
      <p className={styles.timerLabel}><Clock3 size={14} aria-hidden="true"/><MiniPhrase en={upcoming?'Starts in':'Ends in'} am={upcoming?'የሚጀምረው በ':'ቀሪ ጊዜ'}/></p>
      <time className={styles.schedule} dateTime={target}>{date(target)}</time>
     </div>
     <div className={styles.clock}><AuctionCountdown target={target} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} tiles onElapsed={refreshActivity}/></div>
     {upcoming&&<p className={styles.upcoming}><MiniPhrase en="Bidding opens at the scheduled start time." am="ጨረታው በተወሰነው የመጀመሪያ ጊዜ ይከፈታል።"/></p>}
    </div>
    {counts}
   </section>}
  </Card>
  {live&&<div className={styles.bidding} id="bid-review"><Button type="button" data-auction-bid className="card-action" onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><Gavel size={18} aria-hidden="true"/><MiniPhrase en="Place a bid" am="ይጫረቱ"/></Button></div>}
  {bidding&&<BidSheet auction={auction} serverNow={serverNow} onClose={closeBidding} initialChapaId={returnId}/>}
  {ended&&<>
   <AuctionResultDetail auction={auction}/>
   <Card className={styles.overview} role="region" aria-label={activityLabel}>{counts}</Card>
   <div className={styles.resultActions}>
   {publishedResult&&<Link className="primary-button" href={`/winners/${encodeURIComponent(auction.code)}`}><MiniPhrase en="View full result" am="ሙሉ ውጤቱን ይመልከቱ"/><ArrowRight size={16} aria-hidden="true"/></Link>}
   <div className={styles.resultLinks}>
    <Link href="/my-bids?view=history"><MiniPhrase en="View my bid history" am="የእኔን የጨረታ ታሪክ ይመልከቱ"/></Link>
    <Link href="/winners/all"><MiniPhrase en="All results" am="ሁሉም ውጤቶች"/></Link>
   </div>
   </div>
  </>}
  <ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm} compact/>
  <AuctionMoreChances currentCode={auction.code} dialogOpen={bidding}/>
  {!ended&&<section className={styles.actions} aria-label={am?'ጨረታውን ያጋሩ':'Share this auction'}><AuctionShareOptions title={title} code={auction.code}/></section>}
  </div>
 </article>;
}
