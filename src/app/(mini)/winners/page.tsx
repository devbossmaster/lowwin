import Link from 'next/link';
import { Search } from 'lucide-react';
import { db } from '@/lib/db';
import { ResultCard } from '@/components/result-card';
import { OfflineRetry } from '@/components/offline-retry';
import { listPublicResults,resultQuerySchema } from '@/modules/auctions/results';
export default async function Winners({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const parsed=resultQuerySchema.safeParse(await searchParams);
  const query=parsed.success?parsed.data:resultQuerySchema.parse({});
  const results=await listPublicResults(db,query);
  const href=(values:Partial<typeof query>)=>`/winners?${new URLSearchParams({...query,...values,page:String(values.page??query.page)})}`;
  return <><OfflineRetry/><section className="page-inset"><h1 className="page-title">Winners & results<span className="title-dot">.</span></h1><p className="page-lead">Final outcomes, clear rules. An ended auction stays pending until settlement completes.</p>
    <form className="catalog-search" action="/winners"><Search size={19}/><input aria-label="Search results" name="q" defaultValue={query.q} placeholder="Search item or auction code" maxLength={80}/><input type="hidden" name="status" value={query.status}/><button type="submit" aria-label="Submit result search"><Search size={18}/></button></form>
    <nav className="catalog-tabs result-tabs" aria-label="Result status">{(['all','winner','no_winner','cancelled','pending'] as const).map(status=><Link key={status} href={href({status,page:1})} aria-current={query.status===status?'page':undefined}>{({all:'All',winner:'Winners',no_winner:'No winner',cancelled:'Cancelled',pending:'Pending'})[status]}</Link>)}</nav>
    <p className="result-context">Winners are anonymous. <strong>DEMO example</strong> means illustrative only; <strong>DEMO · settled test</strong> means an outcome from local test bids.</p>
    <div className="listing-count">{results.total} {results.total===1?'outcome':'outcomes'}<span>Page {query.page}{results.totalPages>0?` of ${results.totalPages}`:''}</span></div>
    <div className="result-list">{results.items.map(auction=><ResultCard key={auction.code} auction={auction}/>)}</div>
    {results.items.length===0&&<div className="empty-state"><h2>No matching outcomes</h2><p>Try another search or check back after an auction closes.</p><Link className="text-link" href="/winners">Clear filters</Link></div>}
    <nav className="pagination" aria-label="Result pages">{query.page>1&&<Link href={href({page:query.page-1})}>Previous</Link>}{query.page<results.totalPages&&<Link href={href({page:query.page+1})}>Next page</Link>}</nav>
  </section></>;
}
