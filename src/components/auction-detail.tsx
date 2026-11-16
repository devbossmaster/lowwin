'use client';
import Link from 'next/link';
import BidSheet from './bid-sheet';
import dynamic from 'next/dynamic';
import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {chapaUuid} from '@/lib/chapa-client';
import {ChevronDown,Clock3,Eye,Gavel,Hash,LockKeyhole,ShieldCheck,Ticket} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb,formatAuctionBid} from '@/lib/money';
import {AuctionGallery} from './auction-gallery';
import {AuctionResultDetail} from './auction-result-detail';
import {WinnerCelebration} from './celebration';
import {ProductDescription} from './product-description';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShareOptions} from './auction-share';
import {AuctionRule} from './auction-rule';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
const ArifPayReturn=dynamic(()=>import('./arifpay-return').then(module=>module.ArifPayReturn));
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-detail.module.css';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';
import {auctionDetailUrl} from './auction-query';
import {usePrivateQuery} from './private-query';
import {usePublicQuery} from './public-query';
import {auctionPresentationRefreshVersion} from '@/lib/auction-presentation-refresh';

export function AuctionDetail({auction:initialAuction,serverNow}:{auction:CatalogAuction;serverNow:string}){
 const detail=usePublicQuery<CatalogAuction>(auctionDetailUrl(initialAuction.slug),{initialData:initialAuction});
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
 const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const condition=am?(auction.product.conditionAm?.trim()||auction.product.condition):auction.product.condition;
 const delivery=am?(auction.fulfillment.summaryAm?.trim()||auction.fulfillment.summary):auction.fulfillment.summary;
 const region=am?(auction.fulfillment.regionAm?.trim()||auction.fulfillment.region):auction.fulfillment.region;
 const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
 const paymentSheet=bidding?<BidSheet auction={auction} serverNow={serverNow} onClose={closeBidding} initialChapaId={returnId}/>:null;
 if(['closed','cancelled','closing'].includes(auction.status))return <><ArifPayReturn auctionSlug={auction.slug}/>{auction.result?.outcome==='WINNER'&&<WinnerCelebration id={`winner:${auction.code}`}/>}<AuctionResultDetail auction={auction}/>{returnId&&paymentSheet}</>;
 return <article className={styles.page} data-auction-detail>
  <ArifPayReturn auctionSlug={auction.slug}/>
  <div className={styles.hero} data-auction-hero><AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo} priority sizes="(max-width: 639px) 100vw, (max-width: 1023px) 900px, 860px" status={<span className={styles.status}><i aria-hidden="true"/><MiniPhrase en={live?'Live':'Upcoming'} am={live?'ክፍት':'የሚመጣ'}/></span>}/></div>
  <div className={styles.content}>
 <header className={styles.intro}><h1>{title}</h1><Link className={styles.category} href={`/?category=${encodeURIComponent(auction.category.slug)}#discover-auctions`}><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></Link></header>
  <section className={styles.actions} aria-label={am?'ጨረታውን ያጋሩ':'Share this auction'}><AuctionShareOptions title={title} code={auction.code}/></section>
  <dl className={styles.purchaseFacts} data-auction-facts><div className={styles.fee}><dt><Ticket size={16} aria-hidden="true"/><MiniPhrase en="Fee per bid" am="የአንድ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div><div className={styles.auctionCode}><dt><Hash size={16} aria-hidden="true"/><MiniPhrase en="Auction code" am="የጨረታ ኮድ"/></dt><dd>{auction.code}</dd></div></dl>
  {live?<div className={styles.bidding} id="bid-review"><button data-auction-bid className="primary-button card-action" onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><Gavel size={18} aria-hidden="true"/><MiniPhrase en="Place a bid" am="ይጫረቱ"/></button><a className={styles.termsLink} href="#auction-terms"><ShieldCheck size={13} aria-hidden="true"/><MiniPhrase en={isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee only · Non-refundable':'Terms and conditions apply'} am={isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማቅረቢያ ክፍያ ብቻ · አይመለስም':'ውሎች እና ሁኔታዎች ተፈጻሚ ይሆናሉ'}/></a></div>:<p className={styles.upcoming}><MiniPhrase en="Bidding opens at the scheduled start time." am="ጨረታው በተወሰነው የመጀመሪያ ጊዜ ይከፈታል።"/></p>}
  {paymentSheet}
  <section className={styles.stats} aria-label={am?'የጨረታው እንቅስቃሴ':'Auction activity'}>
   <p><Clock3 size={15} aria-hidden="true"/><MiniPhrase en={live?'Time remaining':upcoming?'Starts in':auction.status==='closing'?'Bidding ended':auction.status==='cancelled'?'Auction cancelled':'Auction closed'} am={live?'ቀሪ ጊዜ':upcoming?'የሚጀምረው በ':auction.status==='cancelled'?'ጨረታው ተሰርዟል':'ጨረታው ተጠናቋል'}/></p>
   <div className={styles.clock}>{live||upcoming?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} tiles onElapsed={refreshActivity}/>:<strong>{date(auction.endsAt)}</strong>}</div><p className={styles.schedule}><MiniPhrase en={upcoming?'Starts':'Closes'} am={upcoming?'ይጀምራል':'ይዘጋል'}/> <time dateTime={upcoming?auction.startsAt:auction.endsAt}>{date(upcoming?auction.startsAt:auction.endsAt)}</time> EAT</p>
   <div className={styles.numbers}><div><Gavel size={18} aria-hidden="true"/><span><strong>{auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div><div><Eye size={18} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div></div>
  </section>
  <p className={styles.privacy}><LockKeyhole size={14} aria-hidden="true"/><MiniPhrase en="Chosen numbers stay private until the result is published." am="የተመረጡ ቁጥሮች ውጤቱ እስኪታተም ድረስ በሚስጥር ይቆያሉ።"/></p>
  <div className={styles.description}><ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm}/></div>
  <dl className={styles.facts}><div><dt><MiniPhrase en="Condition" am="ሁኔታ"/></dt><dd>{condition}</dd></div><div><dt><MiniPhrase en="Delivery region" am="የርክክብ አካባቢ"/></dt><dd>{region}</dd></div><div><dt><MiniPhrase en="Delivery" am="ርክክብ"/></dt><dd>{delivery}</dd></div></dl>
  <details id="auction-terms" className={styles.terms}><summary><MiniPhrase en="Auction terms" am="የጨረታ ውሎች"/><ChevronDown size={18}/></summary><dl className={styles.facts}><div><dt><MiniPhrase en="Starts" am="ይጀምራል"/></dt><dd>{date(auction.startsAt)} EAT</dd></div><div><dt><MiniPhrase en="Ends" am="ያበቃል"/></dt><dd>{date(auction.endsAt)} EAT</dd></div><div><dt><MiniPhrase en={auction.terms.maxPoints===null?"Minimum bid":"Bid range"} am={auction.terms.maxPoints===null?"ዝቅተኛ የጨረታ መጠን":"የጨረታ መጠን"}/></dt><dd>{formatAuctionBid(auction.terms.minPoints,auction.terms.ruleVersion)}{auction.terms.maxPoints!==null?` – ${formatAuctionBid(auction.terms.maxPoints,auction.terms.ruleVersion)}`:''}</dd></div><div><dt><MiniPhrase en="Step" am="የጨረታ እርምጃ"/></dt><dd>{formatAuctionBid(auction.terms.stepPoints,auction.terms.ruleVersion)}</dd></div>{Number(auction.terms.entryFeePoints)>0&&<div><dt><MiniPhrase en="Fee per accepted bid" am="ለእያንዳንዱ የተቀበለ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div>}<div><dt><MiniPhrase en="Distinct bids per person" am="ለአንድ ሰው የተለያዩ ጨረታዎች"/></dt><dd>{auction.terms.maxDistinctBids}</dd></div></dl><AuctionRule ruleVersion={auction.terms.ruleVersion} feePoints={auction.terms.entryFeePoints}/><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><p>Terms v{auction.terms.version} · {auction.terms.ruleVersion}</p></details>
  </div>
 </article>;
}
