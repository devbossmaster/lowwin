import Link from 'next/link';
import {redirect} from 'next/navigation';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {AuctionCard} from '@/components/auction-card';
import {MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import {catalogQuerySchema,listAuctions,listCategories,serverNow} from '@/modules/auctions/catalog';
import {AuctionFilters} from './auction-filters';
import styles from './auctions-page.module.css';

type SearchParams=Record<string,string|string[]|undefined>;

export default async function Auctions({searchParams}:{searchParams:Promise<SearchParams>}){
 const supplied=await searchParams;
 const parsed=catalogQuerySchema.safeParse(supplied);
 const query=parsed.success?parsed.data:catalogQuerySchema.parse({});
 const now=await serverNow();
 const [auctions,all,live,upcoming,closed,categories]=await Promise.all([
  listAuctions(query,now,12),
  listAuctions({...query,status:'all',page:1},now,1),
  listAuctions({...query,status:'live',page:1},now,1),
  listAuctions({...query,status:'upcoming',page:1},now,1),
  listAuctions({...query,status:'closed',page:1},now,1),
  listCategories(now),
 ]);
 const href=(changes:Partial<typeof query>)=>{
  const next={...query,...changes};
  const values=new URLSearchParams();
  if(next.q)values.set('q',next.q);
  if(next.category)values.set('category',next.category);
  if(next.sort!=='code')values.set('sort',next.sort);
  if(next.status!=='all')values.set('status',next.status);
  if(next.page>1)values.set('page',String(next.page));
  const suffix=values.toString();
  return `/auctions/all${suffix?`?${suffix}`:''}`;
 };
 if(query.page>Math.max(1,auctions.totalPages))redirect(href({page:Math.max(1,auctions.totalPages)}));
 const statuses=[
  {value:'all' as const,en:'All',am:'ሁሉም',count:all.total,id:'featured'},
  {value:'live' as const,en:'Live',am:'ቀጥታ',count:live.total,id:'active'},
  {value:'upcoming' as const,en:'Upcoming',am:'የሚመጡ',count:upcoming.total,id:'upcoming'},
  {value:'closed' as const,en:'Closed',am:'የተዘጉ',count:closed.total,id:'closed'},
 ];
 const start=auctions.total?(query.page-1)*auctions.pageSize+1:0;
 const end=Math.min(query.page*auctions.pageSize,auctions.total);
 const pages=Array.from(new Set([1,query.page-1,query.page,query.page+1,auctions.totalPages]
  .filter(page=>page>=1&&page<=auctions.totalPages))).sort((a,b)=>a-b);

 return <div className={styles.page}><OfflineRetry/>
  <header className={styles.hero}>
   <h1><MiniPhrase en="Auctions" am="ጨረታዎች"/></h1>
   <p><MiniPhrase en="Find an item, check its opening time, and choose your lowest unique bid." am="የሚፈልጉትን ዕቃ ያግኙ፣ የመጀመሪያ ሰዓቱን ይመልከቱ እና ዝቅተኛውን ልዩ ጨረታዎን ያቅርቡ።"/></p>
   <div className={styles.total}><strong>{all.total}</strong><span><MiniPhrase en="Available auctions" am="ያሉ ጨረታዎች"/></span></div>
  </header>

  <section className={styles.content} aria-label="Auction listings">
   <AuctionFilters query={query} categories={categories}/>
   <nav className={styles.tabs} aria-label="Auction status">
    {statuses.map(status=><Link key={status.value} id={status.id} href={href({status:status.value,page:1})} aria-current={query.status===status.value?'page':undefined}><MiniPhrase en={status.en} am={status.am}/><span>{status.count}</span></Link>)}
   </nav>
   <p className={styles.listing}><MiniPhrase en={`Showing ${start}–${end} of ${auctions.total} auctions`} am={`ከ ${auctions.total} ጨረታዎች ${start}–${end} እየታዩ ነው`}/></p>
   {auctions.items.length?<div className={styles.list} data-auction-list>{auctions.items.map(auction=><AuctionCard key={auction.code} auction={auction} serverNow={auctions.serverNow}/>)}</div>:<p className={styles.empty}><MiniPhrase en="No auctions match these filters. Try another search or status." am="ከእነዚህ ማጣሪያዎች ጋር የሚዛመድ ጨረታ የለም። ሌላ ፍለጋ ወይም ሁኔታ ይሞክሩ።"/></p>}
   {auctions.totalPages>1&&<nav className={styles.pagination} aria-label="Auction pages"><p><MiniPhrase en={`Page ${query.page} of ${auctions.totalPages}`} am={`ገጽ ${query.page} ከ ${auctions.totalPages}`}/></p><div>{query.page>1&&<Link href={href({page:query.page-1})} aria-label="Previous page"><ChevronLeft size={18}/></Link>}{pages.map((page,index)=><span key={page}>{index>0&&page-pages[index-1]>1?'…':null}<Link href={href({page})} aria-current={query.page===page?'page':undefined}>{page}</Link></span>)}{query.page<auctions.totalPages&&<Link href={href({page:query.page+1})} aria-label="Next page"><ChevronRight size={18}/></Link>}</div></nav>}
  </section>
 </div>;
}
