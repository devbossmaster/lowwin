'use client';
import Link from 'next/link';
import {ArrowLeft,ChevronDown,Eye,Gavel,ShieldCheck} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb,formatAuctionBid} from '@/lib/money';
import {AuctionGallery} from './auction-gallery';
import {AuctionResultDetail} from './auction-result-detail';
import {WinnerCelebration} from './celebration';
import {ProductDescription} from './product-description';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShare} from './auction-share';
import {BidForm} from './bid-form';
import {FavoriteButton} from './favorite-button';
import {MiniCategoryName,MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './auction-detail.module.css';
import {useAuctionActivity,useAuctionRefresh} from './auction-activity';

export function AuctionDetail({auction:initialAuction,serverNow}:{auction:CatalogAuction;serverNow:string}){
 const {activity,views,refreshActivity}=useAuctionActivity(initialAuction.code,{record:true});
 useAuctionRefresh(activity,initialAuction.status,Boolean(initialAuction.result));
 const auction={...initialAuction,status:activity?.status??initialAuction.status,viewCount:views??initialAuction.viewCount,bidCount:activity?.bids??initialAuction.bidCount,startsAt:activity?.startsAt??initialAuction.startsAt,endsAt:activity?.endsAt??initialAuction.endsAt};
 const {language}=useMiniLocale(),am=language==='am',live=auction.status==='live',upcoming=auction.status==='upcoming';
 const title=am?(auction.product.titleAm?.trim()||auction.product.title):auction.product.title;
 const condition=am?(auction.product.conditionAm?.trim()||auction.product.condition):auction.product.condition;
 const delivery=am?(auction.fulfillment.summaryAm?.trim()||auction.fulfillment.summary):auction.fulfillment.summary;
 const region=am?(auction.fulfillment.regionAm?.trim()||auction.fulfillment.region):auction.fulfillment.region;
 const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
 if(['closed','cancelled','closing'].includes(auction.status))return <>{auction.result?.outcome==='WINNER'&&<WinnerCelebration id={`winner:${auction.code}`}/>}<AuctionResultDetail auction={auction}/></>;
 return <article className={styles.page}>
  <div className={styles.top}><Link href="/auctions/all" className={styles.back}><ArrowLeft size={17}/><MiniPhrase en="Auctions" am="ጨረታዎች"/></Link><span className={styles.status}><MiniPhrase en={auction.status} am={{live:'በሂደት ላይ',upcoming:'የሚመጣ',closing:'ጨረታው አብቋል',closed:'ተጠናቋል',cancelled:'የተሰረዘ'}[auction.status]}/></span></div>
  <AuctionGallery images={auction.product.images} title={title} isDemo={auction.isDemo}/>
  <header className={styles.intro}><h1>{title}</h1><p className={styles.code}><span><MiniPhrase en="Auction code" am="የጨረታ ኮድ"/>: <strong>{auction.code}</strong></span><span aria-hidden="true">·</span><Link href={`/categories/${auction.category.slug}`}><MiniCategoryName slug={auction.category.slug} name={auction.category.name} nameAm={auction.category.nameAm}/></Link></p></header>
  {Number(auction.terms.entryFeePoints)>0&&<div className={styles.fee}><span><MiniPhrase en="Submission fee" am="የጨረታ አገልግሎት ክፍያ"/></span><strong>{formatEtb(auction.terms.entryFeePoints)}</strong></div>}
  <div className={styles.bidding}><BidForm slug={auction.slug} status={auction.status} isDemo={auction.isDemo} compact/>{live&&<a className={styles.termsLink} href="#auction-terms"><ShieldCheck size={15}/><MiniPhrase en="Terms and conditions apply" am="ውሎች እና ሁኔታዎች ተፈጻሚ ይሆናሉ"/></a>}</div>
  <section className={styles.stats} aria-label="Auction activity">
   <p><MiniPhrase en={live?'This auction ends in':upcoming?'This auction starts in':auction.status==='closing'?'Bidding ended':auction.status==='cancelled'?'Auction cancelled':'Auction closed'} am={live?'ጨረታው የሚያበቃው':upcoming?'ጨረታው የሚጀምረው':auction.status==='cancelled'?'ጨረታው ተሰርዟል':'ጨረታው ተጠናቋል'}/></p>
   <div className={styles.clock}>{live||upcoming?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'} showLabel={false} onElapsed={refreshActivity}/>:<strong>{date(auction.endsAt)}</strong>}</div>
   <div className={styles.numbers}><div><Eye size={24} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div><div><Gavel size={24} aria-hidden="true"/><span><strong>{auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div></div>
  </section>
  <ProductDescription description={auction.product.description} descriptionAm={auction.product.descriptionAm}/>
  <dl className={styles.facts}><div><dt><MiniPhrase en="Condition" am="ሁኔታ"/></dt><dd>{condition}</dd></div><div><dt><MiniPhrase en="Delivery region" am="የርክክብ አካባቢ"/></dt><dd>{region}</dd></div><div><dt><MiniPhrase en="Delivery" am="ርክክብ"/></dt><dd>{delivery}</dd></div></dl>
  <div className={styles.actions}><AuctionShare title={title} code={auction.code}/><FavoriteButton slug={auction.slug}/></div>
  <details id="auction-terms" className={styles.terms}><summary><MiniPhrase en="Auction terms" am="የጨረታ ውሎች"/><ChevronDown size={18}/></summary><dl className={styles.facts}><div><dt><MiniPhrase en="Starts" am="ይጀምራል"/></dt><dd>{date(auction.startsAt)} EAT</dd></div><div><dt><MiniPhrase en="Ends" am="ያበቃል"/></dt><dd>{date(auction.endsAt)} EAT</dd></div><div><dt><MiniPhrase en={auction.terms.maxPoints===null?"Minimum bid":"Bid range"} am={auction.terms.maxPoints===null?"ዝቅተኛ የጨረታ መጠን":"የጨረታ መጠን"}/></dt><dd>{formatAuctionBid(auction.terms.minPoints,auction.terms.ruleVersion)}{auction.terms.maxPoints!==null?` – ${formatAuctionBid(auction.terms.maxPoints,auction.terms.ruleVersion)}`:''}</dd></div><div><dt><MiniPhrase en="Step" am="የጨረታ እርምጃ"/></dt><dd>{formatAuctionBid(auction.terms.stepPoints,auction.terms.ruleVersion)}</dd></div>{Number(auction.terms.entryFeePoints)>0&&<div><dt><MiniPhrase en="Fee per accepted bid" am="ለእያንዳንዱ የተቀበለ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div>}<div><dt><MiniPhrase en="Distinct bids per person" am="ለአንድ ሰው የተለያዩ ጨረታዎች"/></dt><dd>{auction.terms.maxDistinctBids}</dd></div></dl><h3><MiniPhrase en="How a winner is found" am="አሸናፊ እንዴት ይመረጣል"/></h3><p><MiniPhrase en="The lowest ETB amount chosen by exactly one bidder wins. Live amounts and uniqueness stay private." am="በአንድ ተሳታፊ ብቻ የተመረጠው ዝቅተኛው ETB መጠን ያሸንፋል። በሂደት ላይ ያሉ መጠኖች የግል ናቸው።"/></p><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><p>Terms v{auction.terms.version} · {auction.terms.ruleVersion}</p></details>
 </article>;
}
