import Link from 'next/link';
import {Trophy} from 'lucide-react';
import {db} from '@/lib/db';
import {OfflineRetry} from '@/components/offline-retry';
import {WinnerResultCard} from '@/components/winner-result-card';
import {WinnersFilters} from '@/components/winners-filters';
import {listPublicResults,resultQuerySchema} from '@/modules/auctions/results';
import {MiniPhrase} from '@/components/mini-locale';
import styles from '@/components/winners-page.module.css';

export default async function Winners({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const supplied=await searchParams;
  const parsed=resultQuerySchema.safeParse({...supplied,status:'winner',pageSize:supplied.pageSize??12});
  const query=parsed.success?parsed.data:resultQuerySchema.parse({status:'winner',pageSize:12});
  const [results,categories]=await Promise.all([
    listPublicResults(db,query),
    db.category.findMany({where:{visible:true},select:{name:true,slug:true},orderBy:{sortOrder:'asc'}}),
  ]);
  const href=(page:number)=>`/winners/all?${new URLSearchParams({q:query.q,category:query.category,sort:query.sort,pageSize:String(query.pageSize),page:String(page)})}`;
  const pages=Array.from(new Set([1,query.page-1,query.page,query.page+1,results.totalPages].filter(page=>page>=1&&page<=results.totalPages))).sort((a,b)=>a-b);
  const start=results.total?(query.page-1)*query.pageSize+1:0,end=Math.min(query.page*query.pageSize,results.total);
  return <><OfflineRetry/>
    <section className={styles.hero}>
      <h1><Trophy size={34} aria-hidden="true"/><MiniPhrase en="Winners" am="አሸናፊዎች"/></h1>
      <p><MiniPhrase en="Congratulations to all our winners! You can view the winning bids below." am="ለሁሉም አሸናፊዎቻችን እንኳን ደስ አላችሁ! ያሸነፉትን ጨረታዎች ከታች ይመልከቱ።"/></p>
      <div className={styles.total}><strong>{results.total}</strong><span><MiniPhrase en="Total winners" am="ጠቅላላ አሸናፊዎች"/></span></div>
    </section>
    <section className={styles.content}>
      <WinnersFilters query={query} categories={categories}/>
      <p className={styles.listing}><MiniPhrase en={`Showing ${start}–${end} of ${results.total} winners`} am={`ከ ${results.total} አሸናፊዎች ${start}–${end} እየታዩ ነው`}/></p>
      <div className={styles.list}>{results.items.map(auction=><WinnerResultCard key={auction.code} auction={auction}/>)}</div>
      {!results.items.length&&<p className={styles.empty}><MiniPhrase en="No winners found. Try another search or category." am="አሸናፊዎች አልተገኙም። ሌላ ፍለጋ ወይም ምድብ ይሞክሩ።"/></p>}
      {results.totalPages>1&&<nav className={styles.pagination} aria-label="Winner pages"><p><MiniPhrase en={`Page ${query.page} of ${results.totalPages}`} am={`ገጽ ${query.page} ከ ${results.totalPages}`}/></p><div>{query.page>1&&<Link href={href(query.page-1)} aria-label="Previous page">‹</Link>}{pages.map((page,index)=><span key={page}>{index>0&&page-pages[index-1]>1?'…':null}<Link href={href(page)} aria-current={query.page===page?'page':undefined}>{page}</Link></span>)}{query.page<results.totalPages&&<Link href={href(query.page+1)} aria-label="Next page">›</Link>}</div></nav>}
    </section>
  </>;
}
