'use client';
import Link from 'next/link';
import BidSheet from './bid-sheet';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {ChevronDown,Eye,ShieldCheck,Ticket,UsersRound} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb,formatAuctionBid} from '@/lib/money';
import {AuctionGallery} from './auction-gallery';
import {AuctionResultDetail} from './auction-result-detail';
import {WinnerCelebration} from './celebration';
import {ProductDescription} from './product-description';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShare} from './auction-share';
import {AuctionRule} from './auction-rule';
import {isSubmissionFeeOnly} from '@/modules/auctions/rules';
import {useTelegram} from './telegram-provider';
import {prefetchAuctionIntent} from './mini-prefetch';
const ArifPayReturn=dynamic(()=>import('./arifpay-return').then(module=>module.ArifPayReturn));
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-detail.module.css';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';

export function AuctionDetail({auction:initialAuction,serverNow}:{auction:CatalogAuction;serverNow:string}){
 const [bidding,setBidding]=useState(false);
 const {queryIdentity}=useTelegram();
 const warmBid=()=>prefetchAuctionIntent(queryIdentity,initialAuction.slug);
 useEffect(()=>{if(window.location.hash==='#bid-review')setBidding(true)},[]);
 const {activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,viewCount:views??initialAuction.viewCount,bidCount:activity?.bids??initialAuction.bidCount,startsAt:activity?.startsAt??initialAuction.startsAt,endsAt:activity?.endsAt??initialAuction.endsAt};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const condition=am?(auction.product.conditionAm?.trim()||auction.product.condition):auction.product.condition;
 const delivery=am?(auction.fulfillment.summaryAm?.trim()||auction.fulfillment.summary):auction.fulfillment.summary;
 const region=am?(auction.fulfillment.regionAm?.trim()||auction.fulfillment.region):auction.fulfillment.region;
 const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
 if(['closed','cancelled','closing'].includes(auction.status))return <><ArifPayReturn auctionSlug={auction.slug}/>{auction.result?.outcome==='WINNER'&&<WinnerCelebration id={`winner:${auction.code}`}/>}<AuctionResultDetail auction={auction}/></>;
 return <article className={styles.page}>
  <ArifPayReturn auctionSlug={auction.slug}/>
  <AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo} priority status={<span className={styles.status}><i aria-hidden="true"/><MiniPhrase en={live?'Live':'Upcoming'} am={live?'ክፍት':'የሚመጣ'}/></span>}/>
 <header className={styles.intro}><h2>{title}</h2><p className={styles.code}><span><MiniPhrase en="Auction ID" am="የጨረታ መለያ"/>: <strong>{auction.code}</strong></span><span aria-hidden="true">·</span><Link href={`/auctions/all?category=${encodeURIComponent(auction.category.slug)}`}><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></Link></p></header>
  <div className={styles.fee}><span><MiniPhrase en="Submission fee" am="የማቅረቢያ ክፍያ"/></span><strong>{formatEtb(auction.terms.entryFeePoints)}</strong></div>
  {live?<div className={styles.bidding} id="bid-review"><button className="primary-button card-action" onPointerEnter={warmBid} onFocus={warmBid} onTouchStart={warmBid} onClick={()=>setBidding(true)}><Ticket size={17}/><MiniPhrase en={Number(auction.terms.entryFeePoints)>0?`Pay ${formatEtb(auction.terms.entryFeePoints)} & bid`:'Bid now'} am={Number(auction.terms.entryFeePoints)>0?`${formatEtb(auction.terms.entryFeePoints)} ከፍለው ይጫረቱ`:'አሁን ይጫረቱ'}/></button><a className={styles.termsLink} href="#auction-terms"><ShieldCheck size={13}/><MiniPhrase en={isSubmissionFeeOnly(auction.terms.ruleVersion)?'Submission fee only · Non-refundable':'Terms and conditions apply'} am={isSubmissionFeeOnly(auction.terms.ruleVersion)?'የማቅረቢያ ክፍያ ብቻ · አይመለስም':'ውሎች እና ሁኔታዎች ተፈጻሚ ይሆናሉ'}/></a></div>:<p className={styles.upcoming}><MiniPhrase en="Bidding opens at the scheduled start time." am="ጨረታው በተወሰነው የመጀመሪያ ጊዜ ይከፈታል።"/></p>}
  {bidding&&<BidSheet auction={auction} serverNow={serverNow} onClose={()=>setBidding(false)}/>}
  <section className={styles.stats} aria-label="Auction activity">
   <p><MiniPhrase en={live?'This auction ends in':upcoming?'This auction starts in':auction.status==='closing'?'Bidding ended':auction.status==='cancelled'?'Auction cancelled':'Auction closed'} am={live?'ጨረታው የሚያበቃው':upcoming?'ጨረታው የሚጀምረው':auction.status==='cancelled'?'ጨረታው ተሰርዟል':'ጨረታው ተጠናቋል'}/></p>
   <div className={styles.clock}>{live||upcoming?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} tiles onElapsed={refreshActivity}/>:<strong>{date(auction.endsAt)}</strong>}</div><p className={styles.schedule}><MiniPhrase en={upcoming?'Starts':'Closes'} am={upcoming?'ይጀምራል':'ይዘጋል'}/> <time dateTime={upcoming?auction.startsAt:auction.endsAt}>{date(upcoming?auction.startsAt:auction.endsAt)}</time> EAT</p>
   <div className={styles.numbers}><div><Eye size={24} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div><div><UsersRound size={24} aria-hidden="true"/><span><strong>{activity?.bidders?.toLocaleString()??(auction.bidCount===0?'0':'—')}</strong><small><MiniPhrase en="Bidders" am="ተጫራቾች"/></small></span></div></div>
  </section>
  <div className={styles.description}><ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm}/></div>
  <dl className={styles.facts}><div><dt><MiniPhrase en="Condition" am="ሁኔታ"/></dt><dd>{condition}</dd></div><div><dt><MiniPhrase en="Delivery region" am="የርክክብ አካባቢ"/></dt><dd>{region}</dd></div><div><dt><MiniPhrase en="Delivery" am="ርክክብ"/></dt><dd>{delivery}</dd></div></dl>
  <div className={styles.actions}><h2><MiniPhrase en="Share this auction" am="ይህን ጨረታ ያጋሩ"/></h2><p><MiniPhrase en="Send it to someone who would love this prize." am="ይህን ሽልማት ለሚወድ ሰው ያጋሩ።"/></p><AuctionShare title={title} code={auction.code}/></div>
  <details id="auction-terms" className={styles.terms}><summary><MiniPhrase en="Auction terms" am="የጨረታ ውሎች"/><ChevronDown size={18}/></summary><dl className={styles.facts}><div><dt><MiniPhrase en="Starts" am="ይጀምራል"/></dt><dd>{date(auction.startsAt)} EAT</dd></div><div><dt><MiniPhrase en="Ends" am="ያበቃል"/></dt><dd>{date(auction.endsAt)} EAT</dd></div><div><dt><MiniPhrase en={auction.terms.maxPoints===null?"Minimum bid":"Bid range"} am={auction.terms.maxPoints===null?"ዝቅተኛ የጨረታ መጠን":"የጨረታ መጠን"}/></dt><dd>{formatAuctionBid(auction.terms.minPoints,auction.terms.ruleVersion)}{auction.terms.maxPoints!==null?` – ${formatAuctionBid(auction.terms.maxPoints,auction.terms.ruleVersion)}`:''}</dd></div><div><dt><MiniPhrase en="Step" am="የጨረታ እርምጃ"/></dt><dd>{formatAuctionBid(auction.terms.stepPoints,auction.terms.ruleVersion)}</dd></div>{Number(auction.terms.entryFeePoints)>0&&<div><dt><MiniPhrase en="Fee per accepted bid" am="ለእያንዳንዱ የተቀበለ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div>}<div><dt><MiniPhrase en="Distinct bids per person" am="ለአንድ ሰው የተለያዩ ጨረታዎች"/></dt><dd>{auction.terms.maxDistinctBids}</dd></div></dl><AuctionRule ruleVersion={auction.terms.ruleVersion} feePoints={auction.terms.entryFeePoints}/><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><p>Terms v{auction.terms.version} · {auction.terms.ruleVersion}</p></details>
 </article>;
}
