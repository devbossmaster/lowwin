import Link from 'next/link';
import { ArrowRight,ArrowUpRight,Check,LockKeyhole,Search,X } from 'lucide-react';
import { db } from '@/lib/db';
import { listPublicResults } from '@/modules/auctions/results';
import { ResultCard } from '@/components/result-card';
import { IdentityState } from '@/components/identity-state';
import { AuctionCard } from '@/components/auction-card';
import { FeaturedCarousel } from '@/components/featured-carousel';
import { OfflineRetry } from '@/components/offline-retry';
import { listAuctions,listCategories,serverNow } from '@/modules/auctions/catalog';
import {publicHomeContent} from '@/modules/admin/public-content';
export default async function Home() {
  try{return await HomeWithCatalog()}catch(error){
    const failure=error as {code?:string;meta?:{modelName?:string}};
    if(failure.code==='P2021'&&['Auction','Category','Product','AuctionTerms','PublicAuctionResult','AuctionSettlement'].includes(failure.meta?.modelName??''))return <section className="page-inset empty-state"><h1>The catalog is being prepared</h1><p>Auctions are not available yet. Please check back later.</p><Link className="text-link" href="/faq">Read how Lowin works</Link></section>;
    throw error;
  }
}
async function HomeWithCatalog() {
  const now=await serverNow();
  const introduction=await publicHomeContent();
  const [categories,live,closed]=await Promise.all([listCategories(now),listAuctions({q:'',status:'live',sort:'ending',page:1},now,20),listPublicResults(db)]);
  const featured=live.items.filter(item=>item.featured).slice(0,5);
  const ending=live.items.filter(item=>new Date(item.endsAt).getTime()-now.getTime()<=86400000).slice(0,3);
  return <><OfflineRetry/><section className="home-intro"><div className="intro-top"><Link href="/faq">How it works</Link><Link href="/auctions">Auctions <ArrowUpRight size={15}/></Link></div>
    {introduction?<><h1>{introduction.headline}</h1><p>{introduction.lead}</p></>:<><h1>Small is good.<br/><em>Unique is better.</em></h1><p>Explore thoughtful items. The lowest point amount chosen <strong>once</strong> wins when a real auction closes.</p></>}
    <form action="/auctions" className="catalog-search"><Search size={18}/><input name="q" placeholder="Search auctions" aria-label="Search auctions"/><button type="submit" aria-label="Submit search"><ArrowRight size={18}/></button></form>
    <div className="rule-demonstration"><div className="demo-heading"><span>How lowest unique works</span><span>EXAMPLE ONLY</span></div><div className="bid-examples">{[{n:1,count:2},{n:2,count:1},{n:3,count:2},{n:4,count:1}].map(({n,count})=><div key={n} className={`example ${n===2?'winning-example':''}`}><div className="bid-amount">{n}<span>pts</span></div><span className="bid-count">{count} {count===1?'bid':'bids'}</span><div className="example-mark">{n===2?<Check size={17}/>:count===2?<X size={14}/>:<span className="unique-dot"/>}</div></div>)}</div><p><span className="winner-label">2 points wins in this example</span>1 and 3 repeat; 4 is unique but higher.</p></div>
  </section>
  <section className="catalog-section"><div className="section-heading"><div><h2>Browse categories</h2></div><Link href="/auctions" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="category-grid">{categories.map(category=><Link key={category.slug} className="category-tile" href={`/categories/${category.slug}`}><span>{category.name}</span><small>{category.counts.all} {category.counts.all===1?'auction':'auctions'}</small></Link>)}</div></section>
  {featured.length>0&&<section className="catalog-section"><div className="section-heading"><div><h2>Featured auctions</h2></div><Link href="/auctions?status=live" className="see-all">See all <ArrowUpRight size={16}/></Link></div><FeaturedCarousel items={featured}/></section>}
  <section className="catalog-section"><div className="section-heading"><div><h2>Live auctions</h2></div><Link href="/auctions?status=live" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="card-grid">{live.items.slice(0,4).map(item=><AuctionCard key={item.code} auction={item}/>)}</div>{live.total===0&&<p className="inline-empty">No live auctions at the moment. Browse upcoming listings.</p>}</section>
  <section className="catalog-section"><div className="section-heading"><div><h2>Ending within 24 hours</h2></div><Link href="/auctions?status=live&sort=ending" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="card-grid">{ending.map(item=><AuctionCard key={item.code} auction={item}/>)}</div>{ending.length===0&&<p className="inline-empty">Nothing closes within the next 24 hours.</p>}</section>
  <section className="catalog-section"><div className="section-heading"><div><h2>Results & outcomes</h2></div><Link href="/winners" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="result-list">{closed.items.slice(0,3).map(item=><ResultCard key={item.code} auction={item}/>)}</div>{closed.total===0&&<p className="inline-empty">No public results yet.</p>}</section>
  <section className="home-how"><div className="section-heading"><h2>Questions before the first bid?</h2><Link href="/faq" aria-label="Read all frequently asked questions"><ArrowUpRight size={21}/></Link></div><p className="section-copy">Understand points, fees, holds and what happens if no bid is unique.</p><Link className="text-link" href="/faq">Read the FAQ <ArrowRight size={16}/></Link></section>
  <div className="page-inset"><IdentityState/><div className="quiet-note"><LockKeyhole size={16}/><p>Live bid amounts and bidder identities stay private.</p></div></div></>;
}
