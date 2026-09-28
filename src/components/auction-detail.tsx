import {AuctionRule,ResultExplanation} from './auction-rule';
import Link from 'next/link';
import {ArrowLeft,ArrowRight,ChevronDown,Eye,FileText,Gavel,ShieldCheck} from 'lucide-react';
import type {CatalogAuction} from '@/modules/auctions/catalog';
import {formatEtb} from '@/lib/money';
import {AuctionGallery} from './auction-gallery';
import {AuctionCountdown} from './auction-countdown';
import {AuctionShare} from './auction-share';
import {BidForm} from './bid-form';
import {FavoriteButton} from './favorite-button';
import {MiniCategoryName,MiniPhrase} from './mini-locale';
import styles from './auction-detail.module.css';

export function AuctionDetail({auction,serverNow}:{auction:CatalogAuction;serverNow:string}){
 const live=auction.status==='live',upcoming=auction.status==='upcoming';
 const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Addis_Ababa'});
 return <article className={styles.page}>
  <div className={styles.top}><Link href="/auctions/all" className={styles.back}><ArrowLeft size={17}/><MiniPhrase en="Auctions" am="ጨረታዎች"/></Link><span className={styles.status}><MiniPhrase en={auction.status==='closing'?'Result pending':auction.status} am={{live:'በሂደት ላይ',upcoming:'የሚመጣ',closing:'ውጤት በመጠባበቅ ላይ',closed:'የተዘጋ',cancelled:'የተሰረዘ'}[auction.status]}/></span></div>
  <AuctionGallery images={auction.product.images} title={auction.product.title} isDemo={auction.isDemo}/>
  <header className={styles.intro}><h1>{auction.product.title}</h1><p className={styles.code}><span><MiniPhrase en="Auction code" am="የጨረታ ኮድ"/>: <strong>{auction.code}</strong></span><span aria-hidden="true">·</span><Link href={`/categories/${auction.category.slug}`}><MiniCategoryName slug={auction.category.slug} name={auction.category.name}/></Link></p></header>
  <div className={styles.fee}><span><MiniPhrase en="Bid service fee" am="የጨረታ አገልግሎት ክፍያ"/></span><strong>{formatEtb(auction.terms.entryFeePoints)}</strong></div>
  <AuctionRule ruleVersion={auction.terms.ruleVersion}/><div className={styles.bidding}><BidForm slug={auction.slug} status={auction.status} isDemo={auction.isDemo} compact/>{live&&<a className={styles.termsLink} href="#auction-terms"><ShieldCheck size={15}/><MiniPhrase en="Terms and conditions apply" am="ውሎች እና ሁኔታዎች ተፈጻሚ ይሆናሉ"/></a>}</div>
  <div className={styles.actions}><AuctionShare title={auction.product.title} code={auction.code}/><FavoriteButton slug={auction.slug}/></div>
  <section className={styles.stats} aria-label="Auction activity">
   <p><MiniPhrase en={live?'This auction ends in':upcoming?'This auction starts in':auction.status==='closing'?'Bidding ended':auction.status==='cancelled'?'Auction cancelled':'Auction closed'} am={live?'ጨረታው የሚያበቃው':upcoming?'ጨረታው የሚጀምረው':auction.status==='cancelled'?'ጨረታው ተሰርዟል':'ጨረታው ተጠናቋል'}/></p>
   <div className={styles.clock}>{live||upcoming?<AuctionCountdown target={upcoming?auction.startsAt:auction.endsAt} serverNow={serverNow} label={upcoming?'Starts':'Ends'}/>:<strong>{auction.status==='closing'?<MiniPhrase en="Result pending" am="ውጤት በመጠባበቅ ላይ"/>:date(auction.endsAt)}</strong>}</div>
   <div className={styles.numbers}><div><Eye size={24} aria-hidden="true"/><span><strong>{BigInt(auction.viewCount).toLocaleString()}</strong><small><MiniPhrase en="Views" am="እይታዎች"/></small></span></div><div><Gavel size={24} aria-hidden="true"/><span><strong>{auction.bidCount.toLocaleString()}</strong><small><MiniPhrase en="Total bids" am="ጠቅላላ ጨረታዎች"/></small></span></div></div>
  </section>
  {auction.result&&<section className={styles.result}>{auction.result.demoLabel&&<span className="demo-label">{auction.result.demoLabel}</span>}<h2>{auction.result.outcome==='WINNER'?formatEtb(auction.result.winningPoints!):<MiniPhrase en={auction.result.outcome==='NO_WINNER'?'No winner':'Cancelled'} am={auction.result.outcome==='NO_WINNER'?'አሸናፊ የለም':'ተሰርዟል'}/>}</h2><p>{auction.result.source==='SETTLED'?<ResultExplanation outcome={auction.result.outcome} decision={auction.result.decision}/>:auction.result.explanation}</p><Link href={`/winners/${auction.code}`}><MiniPhrase en="View result" am="ውጤትን ይመልከቱ"/><ArrowRight size={15}/></Link></section>}
  {auction.status==='closing'&&<Link className={styles.back} href={`/winners/${auction.code}`}><MiniPhrase en="View pending outcome" am="በመጠባበቅ ላይ ያለውን ውጤት ይመልከቱ"/><ArrowRight size={15}/></Link>}
  <section className={styles.description}><h2><FileText size={22}/><MiniPhrase en="Description" am="መግለጫ"/></h2><p>{auction.product.description}</p><dl className={styles.facts}><div><dt><MiniPhrase en="Condition" am="ሁኔታ"/></dt><dd>{auction.product.condition}</dd></div><div><dt><MiniPhrase en="Delivery region" am="የርክክብ አካባቢ"/></dt><dd>{auction.fulfillment.region}</dd></div><div><dt><MiniPhrase en="Delivery" am="ርክክብ"/></dt><dd>{auction.fulfillment.summary}</dd></div></dl></section>
  <details id="auction-terms" className={styles.terms}><summary><MiniPhrase en="Auction terms" am="የጨረታ ውሎች"/><ChevronDown size={18}/></summary><dl className={styles.facts}><div><dt><MiniPhrase en="Starts" am="ይጀምራል"/></dt><dd>{date(auction.startsAt)} EAT</dd></div><div><dt><MiniPhrase en="Ends" am="ያበቃል"/></dt><dd>{date(auction.endsAt)} EAT</dd></div><div><dt><MiniPhrase en="Bid range" am="የጨረታ መጠን"/></dt><dd>{formatEtb(auction.terms.minPoints)} – {formatEtb(auction.terms.maxPoints)}</dd></div><div><dt><MiniPhrase en="Step" am="የጨረታ እርምጃ"/></dt><dd>{formatEtb(auction.terms.stepPoints)}</dd></div><div><dt><MiniPhrase en="Fee per accepted bid" am="ለእያንዳንዱ የተቀበለ ጨረታ ክፍያ"/></dt><dd>{formatEtb(auction.terms.entryFeePoints)}</dd></div><div><dt><MiniPhrase en="Distinct bids per person" am="ለአንድ ሰው የተለያዩ ጨረታዎች"/></dt><dd>{auction.terms.maxDistinctBids}</dd></div></dl><h3><MiniPhrase en="How a winner is found" am="አሸናፊ እንዴት ይመረጣል"/></h3><p><MiniPhrase en="The lowest whole ETB amount chosen by exactly one bidder wins. Live amounts and uniqueness stay private." am="በአንድ ተሳታፊ ብቻ የተመረጠው ዝቅተኛው ሙሉ ETB መጠን ያሸንፋል። በሂደት ላይ ያሉ መጠኖች የግል ናቸው።"/></p><p>{auction.terms.noWinnerTerms}</p><p>{auction.terms.cancellationTerms}</p><p>Terms v{auction.terms.version} · {auction.terms.ruleVersion}</p></details>
 </article>;
}
