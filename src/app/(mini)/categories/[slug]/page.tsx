import Link from 'next/link';
import {notFound} from 'next/navigation';
import {ArrowLeft,ArrowUpRight,CheckCircle2,Clock3,Flame} from 'lucide-react';
import {ClosedAuctionCarousel} from '@/components/closed-auction-carousel';
import {FeaturedCarousel} from '@/components/featured-carousel';
import {MiniCategoryName,MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import {getCategory,listAuctions,serverNow} from '@/modules/auctions/catalog';
import styles from './category-page.module.css';

export default async function CategoryPage({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params,now=await serverNow(),category=await getCategory(slug,now);if(!category)notFound();
 const [live,upcoming,closing,closed]=await Promise.all([
  listAuctions({q:'',status:'live',sort:'code',category:slug,page:1},now,20),
  listAuctions({q:'',status:'upcoming',sort:'code',category:slug,page:1},now,20),
  listAuctions({q:'',status:'closing',sort:'code',category:slug,page:1},now,20),
  listAuctions({q:'',status:'closed',sort:'code',category:slug,page:1},now,20),
 ]);
 const completed=[...closing.items,...closed.items].sort((left,right)=>Number(left.code)-Number(right.code)),closedTotal=closing.total+closed.total,serverTime=now.toISOString();
 return <div className={styles.page}><OfflineRetry/>
  <div className={styles.heroBand}><section className={styles.hero} aria-labelledby="category-title"><Link className={styles.back} href="/"><ArrowLeft size={16}/><MiniPhrase en="Categories" am="ምድቦች"/></Link><h1 id="category-title"><MiniCategoryName slug={slug} name={category.name} nameAm={category.nameAm}/></h1><p><MiniPhrase en={category.description} am={category.descriptionAm?.trim()||category.description}/></p><div className={styles.counts} aria-label="Auction status counts"><span><Flame size={17}/><strong>{live.total}</strong><MiniPhrase en="live" am="ቀጥታ"/></span><span><Clock3 size={17}/><strong>{upcoming.total}</strong><MiniPhrase en="upcoming" am="የሚመጣ"/></span><span><CheckCircle2 size={17}/><strong>{closedTotal}</strong><MiniPhrase en="closed" am="የተዘጋ"/></span></div></section></div>
  {category.requiresEligibilityReview&&<p className={styles.notice}><MiniPhrase en="Listings in this category require eligibility review before they can open." am="በዚህ ምድብ ያሉ ዝርዝሮች ከመከፈታቸው በፊት የብቁነት ግምገማ ያስፈልጋቸዋል።"/></p>}
  <section className={styles.section} aria-labelledby="live-auctions"><div className={styles.sectionHeading}><div className={`${styles.sectionIcon} ${styles.liveIcon}`}><Flame size={21}/></div><div><h2 id="live-auctions"><MiniPhrase en="Live auctions" am="በሂደት ላይ ያሉ ጨረታዎች"/></h2><span>{live.total} <MiniPhrase en={live.total===1?'auction':'auctions'} am="ጨረታዎች"/></span></div><Link href={`/auctions/all?status=live&category=${encodeURIComponent(slug)}`} aria-label="See all live auctions in this category"><ArrowUpRight size={19}/></Link></div>{live.items.length?<FeaturedCarousel items={live.items} serverNow={serverTime} variant="live"/>:<p className={styles.empty}><MiniPhrase en="No live auctions in this category right now." am="በዚህ ምድብ አሁን ቀጥታ ጨረታ የለም።"/></p>}</section>
  <section className={`${styles.section} ${styles.alt}`} aria-labelledby="upcoming-auctions"><div className={styles.sectionHeading}><div className={`${styles.sectionIcon} ${styles.upcomingIcon}`}><Clock3 size={21}/></div><div><h2 id="upcoming-auctions"><MiniPhrase en="Upcoming auctions" am="የሚመጡ ጨረታዎች"/></h2><span>{upcoming.total} <MiniPhrase en={upcoming.total===1?'auction':'auctions'} am="ጨረታዎች"/></span></div><Link href={`/auctions/all?status=upcoming&category=${encodeURIComponent(slug)}`} aria-label="See all upcoming auctions in this category"><ArrowUpRight size={19}/></Link></div>{upcoming.items.length?<FeaturedCarousel items={upcoming.items} serverNow={serverTime} variant="upcoming"/>:<p className={styles.empty}><MiniPhrase en="No upcoming auctions in this category right now." am="በዚህ ምድብ አሁን የሚመጣ ጨረታ የለም።"/></p>}</section>
  <section className={styles.section} aria-labelledby="closed-auctions"><div className={styles.sectionHeading}><div className={`${styles.sectionIcon} ${styles.closedIcon}`}><CheckCircle2 size={21}/></div><div><h2 id="closed-auctions"><MiniPhrase en="Closed auctions" am="የተዘጉ ጨረታዎች"/></h2><span>{closedTotal} <MiniPhrase en={closedTotal===1?'auction':'auctions'} am="ጨረታዎች"/></span></div><Link href={`/auctions/all?status=closed&category=${encodeURIComponent(slug)}`} aria-label="See all closed auctions in this category"><ArrowUpRight size={19}/></Link></div>{completed.length?<ClosedAuctionCarousel items={completed}/>:<p className={styles.empty}><MiniPhrase en="No closed auctions in this category yet." am="በዚህ ምድብ እስካሁን የተዘጋ ጨረታ የለም።"/></p>}</section>
 </div>;
}
