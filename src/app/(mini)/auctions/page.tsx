import Link from 'next/link';
import { Search,SlidersHorizontal } from 'lucide-react';
import { AuctionCard } from '@/components/auction-card';
import { OfflineRetry } from '@/components/offline-retry';
import { catalogQuerySchema,listAuctions,listCategories,serverNow } from '@/modules/auctions/catalog';
export default async function Auctions({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const query=catalogQuerySchema.parse(Object.fromEntries(Object.entries(params).map(([key,value])=>[key,Array.isArray(value)?value[0]:value])));
  const now=await serverNow();const [result,categories]=await Promise.all([listAuctions(query,now),listCategories(now)]);
  const url=(patch:Record<string,string|number|undefined>)=>{const p=new URLSearchParams({status:query.status,sort:query.sort,...query.q?{q:query.q}:{},...query.category?{category:query.category}:{}});for(const [key,value] of Object.entries(patch))value===undefined?p.delete(key):p.set(key,String(value));return `/auctions?${p}`};
  return <><OfflineRetry/><section className="page-inset catalog-page"><span className="eyebrow">EXPLORE LOWIN</span><h1 className="page-title">Auctions<span className="title-dot">.</span></h1><p className="page-lead">Browse published listings. DEMO items accept test bids only in an isolated local test environment.</p>
    <form action="/auctions" className="catalog-search"><Search size={18}/><input name="q" defaultValue={query.q} placeholder="Search item or code" aria-label="Search item or code"/><input type="hidden" name="status" value={query.status}/>{query.category&&<input type="hidden" name="category" value={query.category}/>}<button type="submit" aria-label="Submit search"><Search size={18}/></button></form>
    <div className="catalog-tabs" role="navigation" aria-label="Auction status">{(['all','live','upcoming','closed'] as const).map(status=><Link key={status} href={url({status,page:1})} aria-current={query.status===status?'page':undefined}>{status[0].toUpperCase()+status.slice(1)}</Link>)}</div>
    <form action="/auctions" className="filter-row"><SlidersHorizontal size={17}/><input type="hidden" name="status" value={query.status}/>{query.q&&<input type="hidden" name="q" value={query.q}/>}<label>Category <select name="category" defaultValue={query.category??''}><option value="">All categories</option>{categories.map(category=><option key={category.slug} value={category.slug}>{category.name}</option>)}</select></label><label>Sort <select name="sort" defaultValue={query.sort}><option value="ending">Ending soon</option><option value="newest">Newest</option><option value="title">Title</option></select></label><button type="submit">Apply</button></form>
    <div className="listing-count">{result.total} {result.total===1?'auction':'auctions'} <span>· Page {query.page} of {Math.max(1,result.totalPages)}</span></div>
    <div className="card-grid">{result.items.map(item=><AuctionCard key={item.code} auction={item}/>)}</div>
    {result.total===0&&<div className="empty-state"><h2>No auctions found</h2><p>Try another category or search term. Animals have no live demo auction.</p><Link className="text-link" href="/auctions">Clear filters</Link></div>}
    <nav className="pagination" aria-label="Auction pages">{query.page>1&&<Link href={url({page:query.page-1})}>Previous</Link>}{query.page<result.totalPages&&<Link href={url({page:query.page+1})}>Next page</Link>}</nav>
  </section></>;
}
