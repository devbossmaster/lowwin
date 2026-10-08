import Link from 'next/link';
import {redirect} from 'next/navigation';
import {ArrowRight,Clock3,Flame,RotateCcw} from 'lucide-react';
import {ClosedAuctionCarousel} from '@/components/closed-auction-carousel';
import {FeaturedCarousel} from '@/components/featured-carousel';
import {MiniCategoryName,MiniPhrase} from '@/components/mini-locale';
import {OfflineRetry} from '@/components/offline-retry';
import {auctionBrowseHref,parseBrowseQuery} from '@/modules/auctions/browse-query';
import {listAuctions,listCategories,serverNow,type CatalogQuery} from '@/modules/auctions/catalog';
import styles from '../auctions-page.module.css';

type SearchParams=Record<string,string|string[]|undefined>;
type BrowseStatus=Exclude<CatalogQuery['status'],'all'>;
type GroupStatus='live'|'upcoming'|'closed';
const PAGE_SIZE=6;
const browseStatuses:GroupStatus[]=['live','upcoming','closed'];
const labels:Record<BrowseStatus,{en:string;am:string}>={
 live:{en:'Live',am:'በሂደት ላይ'},upcoming:{en:'Upcoming',am:'የሚመጡ'},
 closing:{en:'Finalizing',am:'ውጤት በመጠባበቅ ላይ'},closed:{en:'Closed',am:'የተዘጉ'},
};

export default async function AllAuctions({searchParams}:{searchParams:Promise<SearchParams>}){
 const query=parseBrowseQuery(await searchParams),now=await serverNow(),categories=await listCategories(now);
 if(query.category&&!categories.some(category=>category.slug===query.category))redirect(auctionBrowseHref(query,{category:undefined,page:1}));
 const requestedStatuses:BrowseStatus[]=query.status==='closing'?[...browseStatuses,'closing']:browseStatuses;
 const requests=requestedStatuses.map(status=>listAuctions(
  {...query,status,page:query.status===status?query.page:1},now,
  query.status==='all'||query.status===status?PAGE_SIZE:1,
));
 const [allCount,...statusResults]=await Promise.all([
  listAuctions({...query,status:'all',page:1},now,1),...requests,
 ]);
 const results=Object.fromEntries(requestedStatuses.map((status,index)=>[status,statusResults[index]])) as Partial<Record<BrowseStatus,Awaited<ReturnType<typeof listAuctions>>>>;
 const closed=results.closed!;
 const selected=query.status==='all'?null:results[query.status];
 const maximumPage=query.status==='all'?1:Math.max(1,selected?.totalPages??0);
 if(query.page>maximumPage)redirect(auctionBrowseHref(query,{page:maximumPage}));
 const activeCategory=categories.find(category=>category.slug===query.category);
 const sectionStatus:GroupStatus[]=['live','upcoming','closed'];
 const filteredStatus:BrowseStatus=query.status==='all'?'live':query.status;
 const selectedItems=selected?.items??[];
 const statusTabs=[
  {value:'all' as const,en:'All',am:'ሁሉም',count:allCount.total},
  {value:'live' as const,en:'Live',am:'ቀጥታ',count:results.live!.total},
  {value:'upcoming' as const,en:'Upcoming',am:'የሚመጡ',count:results.upcoming!.total},
  {value:'closed' as const,en:'Closed',am:'የተዘጉ',count:closed.total},
 ];
 const pagination=query.status==='all'?maximumPage:(selected?.totalPages??0);
 const title=activeCategory?<MiniCategoryName slug={activeCategory.slug} name={activeCategory.name} nameAm={activeCategory.nameAm}/>:<MiniPhrase en="Auctions" am="ጨረታዎች"/>;
 const sectionData:Record<GroupStatus,Awaited<ReturnType<typeof listAuctions>>>={live:results.live!,upcoming:results.upcoming!,closed};

 return <div className={styles.page}><OfflineRetry/><div className={styles.content}>
  <header className={styles.header}><div><h1>{title}</h1></div><Link className={styles.reset} href="/auctions/all"><RotateCcw size={15}/><MiniPhrase en="Reset" am="አጽዳ"/></Link></header>

  <nav className={styles.tabs} aria-label="Auction status">{statusTabs.map(tab=><Link key={tab.value} href={auctionBrowseHref(query,{status:tab.value,page:1})} aria-current={query.status===tab.value?'page':undefined}><span><MiniPhrase en={tab.en} am={tab.am}/></span><strong>{tab.count}</strong></Link>)}</nav>

  {query.status==='all'?<div className={styles.groups}>
   {sectionStatus.map(status=>{const data=sectionData[status];const headingId=`${status}-auctions-title`;const icon=status==='live'?<Flame size={20}/>:status==='upcoming'?<Clock3 size={20}/>:<RotateCcw size={19}/>;const heading=status==='closed'?'Closed auctions':`${labels[status].en} auctions`;const headingAm=status==='closed'?'የተዘጉ ጨረታዎች':`${labels[status].am} ጨረታዎች`;
    return <section key={status} className={styles.group} aria-labelledby={headingId}><div className={styles.groupHeading}><span className={`${styles.groupIcon} ${styles[`${status}Icon`]}`}>{icon}</span><div><h2 id={headingId}><MiniPhrase en={heading} am={headingAm}/></h2><p>{data.total} <MiniPhrase en={data.total===1?'auction':'auctions'} am="ጨረታዎች"/></p></div><Link href={auctionBrowseHref(query,{status,page:1})} aria-label={`View all ${heading.toLowerCase()}`}><MiniPhrase en="View all" am="ሁሉንም"/><ArrowRight size={16}/></Link></div>
      {data.items.length?(status==='closed'?<ClosedAuctionCarousel items={data.items}/>:<FeaturedCarousel items={data.items} serverNow={now.toISOString()} variant={status}/>):<p className={styles.empty}><MiniPhrase en={`No ${status==='closed'?'closed':status} auctions right now.`} am="በዚህ ሁኔታ ላይ ጨረታ የለም።"/></p>}
    </section>;
   })}
  </div>:<section className={styles.filtered} aria-labelledby="filtered-auctions-title"><div className={styles.groupHeading}><span className={`${styles.groupIcon} ${styles[`${filteredStatus}Icon`]}`}>{filteredStatus==='live'?<Flame size={20}/>:filteredStatus==='upcoming'?<Clock3 size={20}/>:<RotateCcw size={19}/>}</span><div><h2 id="filtered-auctions-title"><MiniPhrase en={`${labels[filteredStatus].en} auctions`} am={`${labels[filteredStatus].am} ጨረታዎች`}/></h2><p>{selected?.total??0} <MiniPhrase en={(selected?.total??0)===1?'auction':'auctions'} am="ጨረታዎች"/></p></div></div>
    {selectedItems.length?(filteredStatus==='closed'||filteredStatus==='closing'?<ClosedAuctionCarousel items={selectedItems}/>:<FeaturedCarousel items={selectedItems} serverNow={now.toISOString()} variant={filteredStatus}/>):<p className={styles.empty}><MiniPhrase en="No auctions match these filters." am="ከእነዚህ መፈለጊያዎች ጋር የሚዛመድ ጨረታ የለም።"/></p>}
   </section>}

  {pagination>1&&<nav className={styles.pagination} aria-label="Auction pages"><p><MiniPhrase en={`Page ${query.page} of ${pagination}`} am={`ገጽ ${query.page} ከ ${pagination}`}/></p><div>{query.page>1&&<Link href={auctionBrowseHref(query,{page:query.page-1})}><MiniPhrase en="Previous" am="ወደ ኋላ"/></Link>}{Array.from({length:pagination},(_,index)=>index+1).filter(page=>page===1||page===pagination||Math.abs(page-query.page)<=1).map(page=><Link key={page} href={auctionBrowseHref(query,{page})} aria-current={page===query.page?'page':undefined}>{page}</Link>)}{query.page<pagination&&<Link href={auctionBrowseHref(query,{page:query.page+1})}><MiniPhrase en="Next" am="ቀጣይ"/></Link>}</div></nav>}
 </div></div>;
}
