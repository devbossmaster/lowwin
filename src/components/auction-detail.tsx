'use client';
import Link from 'next/link';
import BidSheet from './bid-sheet';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {chapaUuid} from '@/lib/chapa-client';
import {ArrowRight,Clock3,Eye,Gavel,Hash,LockKeyhole,ShieldCheck,Ticket} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {AuctionGallery} from './auction-gallery';
import {AuctionResultDetail} from './auction-result-detail';
import {WinnerBanner,winnerBannerData} from './winner-banner';
import {WinnerCelebration} from './celebration';
import {AuctionMoreChances} from './auction-more-chances';
import {ProductDescription} from './product-description';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShareOptions} from './auction-share';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
const ArifPayReturn=dynamic(()=>import('./arifpay-return').then(module=>module.ArifPayReturn));
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-detail.module.css';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import {auctionDetailUrl} from './auction-query';
import {usePrivateQuery} from './private-query';
import {auctionPresentationRefreshVersion} from '@/lib/auction-presentation-refresh';

export function AuctionDetail({auction:initialAuction,serverNow}:{auction:CatalogAuction;serverNow:string}){
 const detail=usePrivateQuery<CatalogAuction>(auctionDetailUrl(initialAuction.slug),{initialData:initialAuction});
 const known=detail.data??initialAuction;
 const params=useSearchParams(),candidate=params.get('chapa'),chapaId=params.getAll('chapa').length===1&&candidate&&chapaUuid.test(candidate)?candidate:undefined;
 const [bidding,setBidding]=useState(!!chapaId),[returnId,setReturnId]=useState(chapaId);
 const {queryIdentity,status,me}=useTelegram();
 const resultQuery=usePrivateQuery<CatalogAuction>('/api/results/'+encodeURIComponent(initialAuction.code),{enabled:['closed','cancelled','closing'].includes(known.status)&&status==='authenticated'&&!!me?.user?.id&&!!queryIdentity});
 const warmBid=()=>prefetchAuctionIntent(queryIdentity,initialAuction.slug);
 useEffect(()=>{if(window.location.hash==='#bid-review')setBidding(true)},[]);
 useEffect(()=>{if(chapaId){setReturnId(chapaId);setBidding(true)}},[chapaId]);
 const closeBidding=()=>{setBidding(false);setReturnId(undefined);const url=new URL(window.location.href);url.searchParams.delete('chapa');if(url.hash==='#bid-review')url.hash='';window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)};
 const {activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{record:true});
 const presentationRequest=useRef({code:initialAuction.code,version:0});
 useEffect(()=>{
  if(presentationRequest.current.code!==initialAuction.code)presentationRequest.current={code:initialAuction.code,version:0};
  const revision=auctionPresentationRefreshVersion(known.presentationVersion,activity?.presentationVersion,presentationRequest.current.version);
  if(revision===null)return;
  presentationRequest.current.version=revision;detail.reload();
 },[initialAuction.code,known.presentationVersion,activity?.presentationVersion,detail.reload]);
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...known,...(resultQuery.data?{result:resultQuery.data.result}:{}),status:activity?.status??known.status,viewCount:views??known.viewCount,bidCount:activity?.bids??known.bidCount,startsAt:activity?.startsAt??known.startsAt,endsAt:activity?.endsAt??known.endsAt};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const ended=['closed','cancelled','closing'].includes(auction.status);
 const winnerArtwork=ended?winnerBannerData(auction):null;
 const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const date=(value:string)=>formatAddisTimestamp(value,am?'am-ET':'en-GB');
 const showPaymentSheet=bidding&&(!ended||!!returnId);
 const statusLabel=live?<MiniPhrase en="Live" am="ክፍት"/>:upcoming?<MiniPhrase en="Upcoming" am="የሚመጣ"/>:auction.status==='cancelled'?<MiniPhrase en="Cancelled" am="ተሰርዟል"/>:<MiniPhrase en="Closed" am="ተዘግቷል"/>;
 return <article className={ended?`${styles.page} ${styles.ended}`:styles.page} data-auction-detail>
  <ArifPayReturn auctionSlug={auction.slug}/>
  {ended&&auction.result?.outcome==='WINNER'&&<WinnerCelebration id={`winner:${auction.code}`}/>}
  <div className={styles.hero} data-auction-hero>
   {winnerArtwork?.banner||winnerArtwork?.photo?<WinnerBanner auction={auction} priority/>:
    <AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo} priority sizes="(max-width: 460px) 100vw, 460px" status={<span className={styles.status}><i aria-hidden="true"/>{statusLabel}</span>}/>}
  </div>
  <div className={styles.content}>
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
  {live&&<div className={styles.bidding} id="bid-review"><button data-auction-bid className="primary-button card-action" onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><Gavel size={18} aria-hidden="true"/><MiniPhrase en="Place a bid" am="ይጫረቱ"/></button><Link className={styles.termsLink} href="/terms"><ShieldCheck size={13} aria-hidden="true"/><MiniPhrase en={auction.terms.ruleVersion==='lowest-unique-v5'?'Paid fees return on cancellation':isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee only · Non-refundable':'Terms and conditions apply'} am={auction.terms.ruleVersion==='lowest-unique-v5'?'ጨረታ ሲሰረዝ የተከፈለው ክፍያ ይመለሳል':isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማቅረቢያ ክፍያ ብቻ · አይመለስም':'ውሎች እና ሁኔታዎች ተፈጻሚ ይሆናሉ'}/></Link></div>}
  {upcoming&&<p className={styles.upcoming}><MiniPhrase en="Bidding opens at the scheduled start time." am="ጨረታው በተወሰነው የመጀመሪያ ጊዜ ይከፈታል።"/></p>}
  {showPaymentSheet&&<BidSheet auction={auction} serverNow={serverNow} onClose={closeBidding} initialChapaId={returnId}/>}
  {ended&&<AuctionResultDetail auction={auction}/>}
  <section className={styles.stats} aria-label={am?'የጨረታው እንቅስቃሴ':'Auction activity'}>
   {!ended&&<div className={styles.countdownPanel}>
    <p className={styles.timerLabel}><Clock3 size={14} aria-hidden="true"/><MiniPhrase en={upcoming?'Starts in':'Time remaining'} am={upcoming?'የሚጀምረው በ':'ቀሪ ጊዜ'}/></p>
    <div className={styles.clock}><AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} tiles onElapsed={refreshActivity}/></div>
    <p className={styles.schedule}><MiniPhrase en={upcoming?'Starts':'Closes'} am={upcoming?'ይጀምራል':'ይዘጋል'}/> <time dateTime={upcoming?auction.startsAt:auction.endsAt}>{date(upcoming?auction.startsAt:auction.endsAt)}</time></p>
   </div>}
   <div className={styles.numbers}><div><Gavel size={14} aria-hidden="true"/><span><strong>{auction.result?.source==='ILLUSTRATIVE'?'—':auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div><div><Eye size={14} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div></div>
  </section>
  {ended?<div className={styles.resultActions}>
   {auction.result&&<Link className="primary-button" href={`/winners/${encodeURIComponent(auction.code)}`}><MiniPhrase en="View full result" am="ሙሉ ውጤቱን ይመልከቱ"/><ArrowRight size={16} aria-hidden="true"/></Link>}
   <div className={styles.resultLinks}>
    <Link href="/my-bids?view=history"><MiniPhrase en="View my bid history" am="የእኔን የጨረታ ታሪክ ይመልከቱ"/></Link>
    <Link href="/winners/all"><MiniPhrase en="All results" am="ሁሉም ውጤቶች"/></Link>
   </div>
  </div>:<p className={styles.privacy}><LockKeyhole size={14} aria-hidden="true"/><MiniPhrase en="Chosen numbers stay private until the result is published." am="የተመረጡ ቁጥሮች ውጤቱ እስኪታተም ድረስ በሚስጥር ይቆያሉ።"/></p>}
  <ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm} compact/>
  <AuctionMoreChances currentCode={auction.code} dialogOpen={showPaymentSheet}/>
  {!ended&&<section className={styles.actions} aria-label={am?'ጨረታውን ያጋሩ':'Share this auction'}><AuctionShareOptions title={title} code={auction.code}/></section>}
  </div>
 </article>;
}
