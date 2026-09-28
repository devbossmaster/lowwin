import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft,ArrowUpRight } from 'lucide-react';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import { getCategory,listAuctions,serverNow } from '@/modules/auctions/catalog';
import {MiniCategoryName,MiniPhrase} from '@/components/mini-locale';
export default async function CategoryPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params,now=await serverNow(),category=await getCategory(slug,now);if(!category)notFound();
  const groups=await Promise.all((['live','upcoming','closing','closed'] as const).map(status=>listAuctions({q:'',status,sort:'ending',category:slug,page:1},now,3)));
  return <><OfflineRetry/><section className="page-inset"><Link className="back-link" href="/auctions"><ArrowLeft size={16}/> <MiniPhrase en="All auctions" am="ሁሉም ጨረታዎች"/></Link><h1 className="page-title"><MiniCategoryName slug={slug} name={category.name}/><span className="title-dot">.</span></h1><p className="page-lead">{category.description}</p><div className="category-counts"><span><strong>{category.counts.all}</strong> <MiniPhrase en="all" am="ሁሉም"/></span><span><strong>{category.counts.live}</strong> <MiniPhrase en="live" am="በሂደት ላይ"/></span><span><strong>{category.counts.upcoming}</strong> <MiniPhrase en="upcoming" am="የሚመጡ"/></span><span><strong>{category.counts.closed}</strong> <MiniPhrase en="closed" am="የተዘጉ"/></span></div>
    {category.requiresEligibilityReview&&<p className="notice-card"><MiniPhrase en="Animal listings require eligibility and welfare review. There is no live Animals auction." am="የእንስሳት ዝርዝሮች የብቁነት እና የደህንነት ግምገማ ይፈልጋሉ። በሂደት ላይ ያለ የእንስሳት ጨረታ የለም።"/></p>}
  </section>{(['live','upcoming','closing','closed'] as const).map((status,index)=><section className="catalog-section" key={status}><div className="section-heading"><h2><MiniPhrase en={status[0].toUpperCase()+status.slice(1)} am={{live:'በሂደት ላይ',upcoming:'የሚመጡ',closing:'በመዘጋት ላይ',closed:'የተዘጉ'}[status]}/></h2><Link className="see-all" href={`/auctions?status=${status}&category=${slug}`}><MiniPhrase en="See all" am="ሁሉንም ይመልከቱ"/> <ArrowUpRight size={16}/></Link></div><div className="card-grid">{groups[index].items.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>{groups[index].total===0&&<p className="inline-empty"><MiniPhrase en={`No ${status} auctions in ${category.name.toLowerCase()} right now.`} am="በዚህ ምድብ ለአሁኑ ጊዜ ተዛማጅ ጨረታዎች የሉም።"/></p>}</section>)}</>;
}
