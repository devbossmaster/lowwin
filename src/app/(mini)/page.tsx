import Link from 'next/link';
import { ArrowRight,ArrowUpRight,LockKeyhole } from 'lucide-react';
import styles from '@/components/home-banner.module.css';
import {HomeCategories} from '@/components/home-categories';
import {MiniText} from '@/components/mini-locale';
import { db } from '@/lib/db';
import { listPublicResults } from '@/modules/auctions/results';
import { ResultCard } from '@/components/result-card';
import { IdentityState } from '@/components/identity-state';
import { AuctionCard } from '@/components/auction-card';
import { FeaturedCarousel } from '@/components/featured-carousel';
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
  const [categories,live,closed]=await Promise.all([listCategories(now),listAuctions({q:'',status:'live',sort:'ending',page:1},now,20),listPublicResults(db)]);
  const featured=live.items.filter(item=>item.featured).slice(0,5);
  const ending=live.items.filter(item=>new Date(item.endsAt).getTime()-now.getTime()<=86400000).slice(0,3);
  return <><OfflineRetry/><h1 className="sr-only">Lowwin auctions</h1><Link href="/auctions" className={styles.banner} aria-label="Explore Lowwin auctions"><img src="/banner1.png" alt="Lowwin — bid low to win" width={1024} height={572} fetchPriority="high"/><span className={styles.bannerAction}><MiniText id="startBidding"/> <ArrowRight size={15} aria-hidden="true"/></span></Link>
  <HomeCategories categories={categories}/>
  {featured.length>0&&<section className="catalog-section"><div className="section-heading"><div><h2><MiniText id="featured"/></h2></div><Link href="/auctions?status=live" className="see-all"><MiniText id="seeAll"/> <ArrowUpRight size={16}/></Link></div><FeaturedCarousel items={featured} serverNow={now.toISOString()}/></section>}
  <section className="catalog-section"><div className="section-heading"><div><h2><MiniText id="ending"/></h2></div><Link href="/auctions?status=live&sort=ending" className="see-all"><MiniText id="seeAll"/> <ArrowUpRight size={16}/></Link></div><div className="card-grid">{ending.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>{ending.length===0&&<p className="inline-empty"><MiniText id="nothingEnding"/></p>}</section>
  <section className="catalog-section"><div className="section-heading"><div><h2><MiniText id="results"/></h2></div><Link href="/winners" className="see-all"><MiniText id="seeAll"/> <ArrowUpRight size={16}/></Link></div><div className="result-list">{closed.items.slice(0,3).map(item=><ResultCard key={item.code} auction={item}/>)}</div>{closed.total===0&&<p className="inline-empty"><MiniText id="noResults"/></p>}</section>
  <section className="home-how"><div className="section-heading"><h2><MiniText id="questions"/></h2><Link href="/faq" aria-label="Read all frequently asked questions"><ArrowUpRight size={21}/></Link></div><p className="section-copy"><MiniText id="faqBlurb"/></p><Link className="text-link" href="/faq"><MiniText id="readFaq"/> <ArrowRight size={16}/></Link></section>
  <div className="page-inset"><IdentityState/><div className="quiet-note"><LockKeyhole size={16}/><p><MiniText id="privateBids"/></p></div></div></>;
}
