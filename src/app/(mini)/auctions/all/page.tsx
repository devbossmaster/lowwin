import Link from 'next/link';
import {Search,ArrowRight} from 'lucide-react';
import {redirect} from 'next/navigation';
import {AuctionCard} from '@/components/auction-card';
import {HomeCategories} from '@/components/home-categories';
import {MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import {auctionBrowseHref,parseBrowseQuery} from '@/modules/auctions/browse-query';
import {listAuctions,listCategories,serverNow} from '@/modules/auctions/catalog';
import styles from '../auctions-page.module.css';
type SearchParams=Record<string,string|string[]|undefined>;
export default async function AllAuctions({searchParams}:{searchParams:Promise<SearchParams>}){
 const raw=await searchParams,query=parseBrowseQuery({...raw,sort:raw.sort??'newest'}),now=await serverNow();
 const [data,categories]=await Promise.all([listAuctions(query,now,8),listCategories(now)]);
 if(query.page>Math.max(1,data.totalPages))redirect(auctionBrowseHref(query,{page:Math.max(1,data.totalPages)}));
 return <div className={styles.page}><OfflineRetry/><header className={styles.header}><div><h1><MiniPhrase en="Find your next favourite" am="የሚወዱትን ዕቃ ያግኙ"/></h1><p><MiniPhrase en="Browse. Choose a number. Follow the draw." am="ይመልከቱ። ቁጥር ይምረጡ። ውጤቱን ይከታተሉ።"/></p></div></header>
  <form action="/auctions/all" className={styles.search} id="auction-search"><Search size={18}/><input name="q" defaultValue={query.q} maxLength={80} aria-label="Search auctions" placeholder="Search / ፈልግ"/>{query.category&&<input type="hidden" name="category" value={query.category}/>}<button type="submit" aria-label="Search"><ArrowRight size={19}/></button></form>
  <HomeCategories categories={categories}/>
  <div className={styles.content}><nav className={styles.tabs} aria-label="Auction status">{([{value:'all',en:'All',am:'ሁሉም'},{value:'live',en:'Open',am:'ክፍት'},{value:'upcoming',en:'Upcoming',am:'የሚመጡ'},{value:'closed',en:'Closed',am:'የተዘጉ'}] as const).map(tab=><Link key={tab.value} href={auctionBrowseHref(query,{status:tab.value,page:1})} aria-current={query.status===tab.value?'page':undefined}><MiniPhrase en={tab.en} am={tab.am}/></Link>)}</nav>
  <div className={styles.sort}><span>{data.total} <MiniPhrase en="auctions" am="ጨረታዎች"/></span><div><Link href={auctionBrowseHref(query,{sort:'newest',page:1})} aria-current={query.sort==='newest'?'true':undefined}><MiniPhrase en="Newest" am="አዲስ"/></Link><Link href={auctionBrowseHref(query,{sort:'ending',page:1})} aria-current={query.sort==='ending'?'true':undefined}><MiniPhrase en="Ending soon" am="የሚያበቁ"/></Link></div></div>
  {data.items.length?<div className={styles.list}>{data.items.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>:<div className={styles.empty}><h2><MiniPhrase en="Nothing here just yet" am="እዚህ ገና ምንም የለም"/></h2><p><MiniPhrase en="Try another search or come back for new auctions." am="ሌላ ፍለጋ ይሞክሩ ወይም ለአዳዲስ ጨረታዎች ይመለሱ።"/></p><Link href="/auctions/all"><MiniPhrase en="Clear filters" am="መፈለጊያዎችን አጽዳ"/></Link></div>}
  {data.totalPages>1&&<nav className={styles.pagination} aria-label="Auction pages">{query.page>1&&<Link href={auctionBrowseHref(query,{page:query.page-1})}><MiniPhrase en="Previous" am="ወደ ኋላ"/></Link>}<span>{query.page} / {data.totalPages}</span>{query.page<data.totalPages&&<Link href={auctionBrowseHref(query,{page:query.page+1})}><MiniPhrase en="Next" am="ቀጣይ"/></Link>}</nav>}
 </div></div>;
}
