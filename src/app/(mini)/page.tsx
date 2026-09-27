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
import {CatalogImage} from '@/components/catalog-image';
import {publicHomeContent} from '@/modules/admin/public-content';
import {legacyTermsInEtb} from '@/lib/money';
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
  return <><OfflineRetry/><section className="home-intro">
    <form action="/auctions" className="catalog-search home-search"><Search size={18}/><input name="q" placeholder="Find your next favorite" aria-label="Search auctions"/><button type="submit" aria-label="Submit search"><ArrowRight size={18}/></button></form>
    <h1>{introduction?.headline??'A little different wins.'}</h1><p>{legacyTermsInEtb(introduction?.lead??'The lowest ETB amount chosen only once wins. Find an auction and make your choice.')}</p>
    <div className="rule-demonstration"><div className="demo-heading"><span>The lowest unique bid</span><span>EXAMPLE ONLY</span></div><div className="bid-examples">{[1,1,2,3,3,4].map((n,i)=><div key={i} className={`example ${n===2?'winning-example':''}`}><div className="bid-amount">{n}<span>ETB</span></div><div className="example-mark">{n===2?<Check size={17}/>:n===4?<span className="unique-dot"/>:<X size={14}/>}</div></div>)}</div><p><span className="winner-label">ETB 2.00 wins in this example.</span> 1 and 3 repeat; 4 is unique but higher.</p></div>
    <div className="hero-actions"><Link className="primary-button" href="/auctions">Browse auctions <ArrowRight size={17}/></Link><Link className="text-link" href="#how-it-works">How it works</Link></div><p className="hero-terms">Up to 100 distinct amounts per auction. Review the fee and highest-bid hold before you confirm.</p>
  </section>
  <section className="catalog-section"><div className="section-heading"><div><h2>Browse categories</h2></div><Link href="/auctions" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="category-grid">{categories.map(category=><Link key={category.slug} className="category-tile" href={`/categories/${category.slug}`}><CatalogImage src={`/catalog/${({'home-furniture':'chair',vehicles:'vehicle',accessories:'accessory','computer-office-equipment':'computer','home-furnishings':'furnishing',jewelry:'jewelry',watches:'watch',phones:'phone',animals:'animal'} as Record<string,string>)[category.slug]??'chair'}.svg`} alt=""/><span>{category.name}</span><small>{category.counts.all} {category.counts.all===1?'auction':'auctions'}</small></Link>)}</div></section>
  {featured.length>0&&<section className="catalog-section"><div className="section-heading"><div><h2>Featured auctions</h2></div><Link href="/auctions?status=live" className="see-all">See all <ArrowUpRight size={16}/></Link></div><FeaturedCarousel items={featured} serverNow={now.toISOString()}/></section>}
  <section className="catalog-section"><div className="section-heading"><div><h2>Ending within 24 hours</h2></div><Link href="/auctions?status=live&sort=ending" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="card-grid">{ending.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>{ending.length===0&&<p className="inline-empty">Nothing closes within the next 24 hours.</p>}</section>
  <section className="catalog-section"><div className="section-heading"><div><h2>Results & outcomes</h2></div><Link href="/winners" className="see-all">See all <ArrowUpRight size={16}/></Link></div><div className="result-list">{closed.items.slice(0,3).map(item=><ResultCard key={item.code} auction={item}/>)}</div>{closed.total===0&&<p className="inline-empty">No public results yet.</p>}</section>
  <section className="catalog-section how-steps" id="how-it-works"><h2>Three steps. One different choice.</h2><ol>{[{title:'Open in Telegram',text:'Launch Lowin from the bot and share your own contact.'},{title:'Pick your auction',text:'Explore the item, ETB bid range, fee and published terms.'},{title:'Choose your ETB amount',text:'Review your highest-bid hold and submit. The lowest unique amount wins after closing.'}].map(step=><li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol><Link className="text-link" href="/faq">All rules & terms <ArrowUpRight size={16}/></Link></section>
  <section className="home-how"><div className="section-heading"><h2>Questions before the first bid?</h2><Link href="/faq" aria-label="Read all frequently asked questions"><ArrowUpRight size={21}/></Link></div><p className="section-copy">Understand ETB bids, fees, holds and what happens if no bid is unique.</p><Link className="text-link" href="/faq">Read the FAQ <ArrowRight size={16}/></Link></section>
  <div className="page-inset"><IdentityState/><div className="quiet-note"><LockKeyhole size={16}/><p>Live bid amounts and bidder identities stay private.</p></div></div></>;
}
