import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft,ArrowUpRight } from 'lucide-react';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import { getCategory,listAuctions,serverNow } from '@/modules/auctions/catalog';
export default async function CategoryPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params,now=await serverNow(),category=await getCategory(slug,now);if(!category)notFound();
  const groups=await Promise.all((['live','upcoming','closing','closed'] as const).map(status=>listAuctions({q:'',status,sort:'ending',category:slug,page:1},now,3)));
  return <><OfflineRetry/><section className="page-inset"><Link className="back-link" href="/auctions"><ArrowLeft size={16}/> All auctions</Link><h1 className="page-title">{category.name}<span className="title-dot">.</span></h1><p className="page-lead">{category.description}</p><div className="category-counts"><span><strong>{category.counts.all}</strong> all</span><span><strong>{category.counts.live}</strong> live</span><span><strong>{category.counts.upcoming}</strong> upcoming</span><span><strong>{category.counts.closed}</strong> closed</span></div>
    {category.requiresEligibilityReview&&<p className="notice-card">Animal listings require eligibility and welfare review. There is no live Animals auction.</p>}
  </section>{(['live','upcoming','closing','closed'] as const).map((status,index)=><section className="catalog-section" key={status}><div className="section-heading"><h2>{status[0].toUpperCase()+status.slice(1)}</h2><Link className="see-all" href={`/auctions?status=${status}&category=${slug}`}>See all <ArrowUpRight size={16}/></Link></div><div className="card-grid">{groups[index].items.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>{groups[index].total===0&&<p className="inline-empty">No {status} auctions in {category.name.toLowerCase()} right now.</p>}</section>)}</>;
}
