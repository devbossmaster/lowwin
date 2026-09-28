import {CheckCircle2,Clock3,Flame,Sparkles} from 'lucide-react';
import {ClosedAuctionCarousel} from '@/components/closed-auction-carousel';
import {FeaturedCarousel} from '@/components/featured-carousel';
import {MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import {listAuctions,serverNow} from '@/modules/auctions/catalog';
import styles from './auctions-page.module.css';

function Count({value}:{value:number}){
 return <span className={styles.count}>{value} <MiniPhrase en={value===1?'auction':'auctions'} am="ጨረታዎች"/></span>;
}

export default async function Auctions({searchParams}:{searchParams:Promise<{q?:string|string[]}>}){
 const search=await searchParams,q=typeof search.q==='string'?search.q.trim().slice(0,80):'';
 const now=await serverNow();
 const [live,upcoming,closing,closed]=await Promise.all([
  listAuctions({q,status:'live',sort:'ending',page:1},now,50),
  listAuctions({q,status:'upcoming',sort:'ending',page:1},now,50),
  listAuctions({q,status:'closing',sort:'ending',page:1},now,50),
  listAuctions({q,status:'closed',sort:'ending',page:1},now,50),
 ]);
 const featured=live.items.filter(item=>item.featured),completed=[...closing.items,...closed.items],serverTime=now.toISOString();
 return <main className={styles.page}><OfflineRetry/>
  <header className={styles.hero}>
   {q&&<p role="status"><MiniPhrase en="Results for" am="የፍለጋ ውጤት"/> “{q}”</p>}
   <div><span><Sparkles size={15}/><MiniPhrase en="Explore Lowwin" am="Lowwinን ያስሱ"/></span><h1><MiniPhrase en="All auctions" am="ሁሉም ጨረታዎች"/></h1><p><MiniPhrase en="Swipe through every auction and place your lowest unique bid." am="ሁሉንም ጨረታዎች ይመልከቱ እና ዝቅተኛውን ልዩ ጨረታዎን ያስገቡ።"/></p></div>
   <div className={styles.summary}><span><strong>{live.total}</strong><MiniPhrase en="Live" am="ቀጥታ"/></span><span><strong>{upcoming.total}</strong><MiniPhrase en="Upcoming" am="የሚመጡ"/></span><span><strong>{closing.total+closed.total}</strong><MiniPhrase en="Closed" am="የተዘጉ"/></span></div>
  </header>

  <section className={`${styles.section} ${styles.featured}`} id="featured" aria-labelledby="featured-heading">
   <div className={styles.heading}><div className={styles.featuredIcon}><Sparkles size={20}/></div><div><h2 id="featured-heading"><MiniPhrase en="Featured auctions" am="ተለይተው የቀረቡ ጨረታዎች"/></h2><Count value={featured.length}/></div></div>
   {featured.length?<FeaturedCarousel items={featured} serverNow={serverTime}/>:<p className={styles.empty}><MiniPhrase en="No featured auctions right now." am="አሁን ተለይቶ የቀረበ ጨረታ የለም።"/></p>}
  </section>

  <section className={styles.section} id="active" aria-labelledby="active-heading">
   <div className={styles.heading}><div className={styles.liveIcon}><Flame size={21}/></div><div><h2 id="active-heading"><MiniPhrase en="Active auctions" am="በሂደት ላይ ያሉ ጨረታዎች"/></h2><Count value={live.total}/></div></div>
   {live.items.length?<FeaturedCarousel items={live.items} serverNow={serverTime} variant="live"/>:<p className={styles.empty}><MiniPhrase en="No active auctions right now." am="አሁን በሂደት ላይ ያለ ጨረታ የለም።"/></p>}
  </section>

  <section className={`${styles.section} ${styles.soft}`} id="upcoming" aria-labelledby="upcoming-heading">
   <div className={styles.heading}><div className={styles.upcomingIcon}><Clock3 size={21}/></div><div><h2 id="upcoming-heading"><MiniPhrase en="Upcoming auctions" am="የሚመጡ ጨረታዎች"/></h2><Count value={upcoming.total}/></div></div>
   {upcoming.items.length?<FeaturedCarousel items={upcoming.items} serverNow={serverTime} variant="upcoming"/>:<p className={styles.empty}><MiniPhrase en="No upcoming auctions right now." am="አሁን የሚመጣ ጨረታ የለም።"/></p>}
  </section>

  <section className={styles.section} id="closed" aria-labelledby="closed-heading">
   <div className={styles.heading}><div className={styles.closedIcon}><CheckCircle2 size={21}/></div><div><h2 id="closed-heading"><MiniPhrase en="Closed auctions" am="የተዘጉ ጨረታዎች"/></h2><Count value={closing.total+closed.total}/></div></div>
   {completed.length?<ClosedAuctionCarousel items={completed}/>:<p className={styles.empty}><MiniPhrase en="No closed auctions yet." am="እስካሁን የተዘጋ ጨረታ የለም።"/></p>}
  </section>
 </main>;
}
