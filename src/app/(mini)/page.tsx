import Image from 'next/image';
import {resolveHomeCopy} from '@/components/home-copy';
import {publicHomeContent} from '@/modules/admin/public-content';
import Link from 'next/link';
import { ArrowRight,ArrowUpRight,LockKeyhole } from 'lucide-react';
import styles from '@/components/home-banner.module.css';
import {HomeCategories} from '@/components/home-categories';
import {MiniPhrase,MiniText} from '@/components/mini-locale';
import { db } from '@/lib/db';
import { listPublicResults } from '@/modules/auctions/results';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { ClosedAuctionCarousel } from '@/components/closed-auction-carousel';
import { HomeFinish } from '@/components/home-finish';
import { OfflineRetry } from '@/components/offline-retry';
import { listAuctions,listCategories,serverNow } from '@/modules/auctions/catalog';
export default async function Home() {
  try{return await HomeWithCatalog()}catch(error){
    const failure=error as {code?:string;meta?:{modelName?:string}};
    if(failure.code==='P2021'&&['Auction','Category','Product','AuctionTerms','PublicAuctionResult','AuctionSettlement'].includes(failure.meta?.modelName??''))return <section className="page-inset empty-state"><h1>The catalog is being prepared</h1><p>Auctions are not available yet. Please check back later.</p><Link className="text-link" href="/faq">Read how Lowwin works</Link></section>;
    throw error;
  }
}
async function HomeWithCatalog() {
  const now=await serverNow();
  const [categories,live,closed,managed]=await Promise.all([listCategories(now),listAuctions({q:'',status:'live',sort:'ending',page:1},now,20),listPublicResults(db),publicHomeContent()]);
  const heroCopy=resolveHomeCopy(managed);
  const featured=live.items.filter(item=>item.featured).slice(0,5);
  const ending=live.items.filter(item=>new Date(item.endsAt).getTime()-now.getTime()<=86400000).slice(0,3);
  return <><OfflineRetry/><section className="managed-home-copy"><h1><MiniPhrase en={heroCopy.headline} am={heroCopy.headlineAm}/></h1><p><MiniPhrase en={heroCopy.lead} am={heroCopy.leadAm}/></p></section><section className={styles.hero}><Link href="/auctions/all" className={styles.banner} aria-label="Explore Lowwin auctions"><Image src="/banner1.png" alt="Lowwin — bid low to win" width={1024} height={572} sizes="(max-width: 480px) 100vw, 480px" preload/><span className={styles.bannerAction}><MiniText id="startBidding"/> <ArrowRight size={15} aria-hidden="true"/></span></Link></section>
  <HomeCategories categories={categories}/>
  {featured.length>0&&<section className={`${styles.featuredSection} catalog-section`}><div className="section-heading"><div><h2><MiniText id="featured"/></h2><p><MiniPhrase en="The lowest unique ETB bid wins. Check the fee and closing time before you bid." am="ዝቅተኛው ልዩ ETB ጨረታ ያሸንፋል። ከመጫረትዎ በፊት ክፍያውን እና የመዘጊያ ጊዜውን ይመልከቱ።"/></p></div></div><FeaturedCarousel items={featured} serverNow={now.toISOString()}/><Link href="/auctions/all#active" className={styles.featuredAll}><MiniPhrase en="See all auctions" am="ሁሉንም ጨረታዎች ይመልከቱ"/> <ArrowRight size={16}/></Link></section>}
  <section className={`${styles.featuredSection} ${styles.endingSection} catalog-section`}><div className="section-heading"><div><h2><MiniPhrase en="Ending soon auctions" am="በቅርቡ የሚያበቁ ጨረታዎች"/></h2><p><MiniPhrase en="These auctions close within 24 hours. Place your bid before time runs out." am="እነዚህ ጨረታዎች በ24 ሰዓት ውስጥ ያበቃሉ። ጊዜው ከማለቁ በፊት ጨረታዎን ያቅርቡ።"/></p></div></div>{ending.length>0?<><FeaturedCarousel items={ending} serverNow={now.toISOString()} variant="ending"/><Link href="/auctions?status=live&sort=ending" className={styles.featuredAll}><MiniPhrase en="View ending auctions" am="በቅርቡ የሚያበቁትን ይመልከቱ"/> <ArrowRight size={16}/></Link></>:<p className="inline-empty"><MiniText id="nothingEnding"/></p>}</section>
  <section className={`${styles.featuredSection} ${styles.closedSection} catalog-section`}><div className="section-heading"><div><h2><MiniPhrase en="Closed auctions" am="የተዘጉ ጨረታዎች"/></h2><p><MiniPhrase en="See final outcomes after closing. A passed end time alone never declares a winner." am="ጨረታው ከተዘጋ በኋላ የመጨረሻ ውጤቱን ይመልከቱ። የመዝጊያ ጊዜ ማለፍ ብቻ አሸናፊ አያረጋግጥም።"/></p></div></div>{closed.items.length>0?<><ClosedAuctionCarousel items={closed.items.slice(0,5)}/><Link href="/winners/all" className={styles.featuredAll}><MiniPhrase en="See all results" am="ሁሉንም ውጤቶች ይመልከቱ"/> <ArrowRight size={16}/></Link></>:<p className="inline-empty"><MiniText id="noResults"/></p>}</section>
  <section className="home-how"><div className="section-heading"><h2><MiniText id="questions"/></h2><Link href="/faq" aria-label="Read all frequently asked questions"><ArrowUpRight size={21}/></Link></div><p className="section-copy"><MiniText id="faqBlurb"/></p><Link className="text-link" href="/faq"><MiniText id="readFaq"/> <ArrowRight size={16}/></Link></section>
  <div className="page-inset"><div className="quiet-note"><LockKeyhole size={16}/><p><MiniText id="privateBids"/></p></div></div><HomeFinish/></>;
}
