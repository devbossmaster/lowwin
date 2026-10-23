import Link from 'next/link';
import {ArrowRight,Search,Trophy} from 'lucide-react';
import {HomeHero} from '@/components/home-hero';
import {HomeCategories} from '@/components/home-categories';
import {resolveHomeCopy} from '@/components/home-copy';
import {publicHomeContent} from '@/modules/admin/public-content';
import {MiniPhrase} from '@/components/mini-locale';
import {AuctionCard} from '@/components/auction-card';
import {AuctionSortLinks} from '@/components/auction-sort-links';
import {parseBrowseQuery} from '@/modules/auctions/browse-query';
import {CatalogImage} from '@/components/catalog-image';
import {OfflineRetry} from '@/components/offline-retry';
import {db} from '@/lib/db';
import {formatAuctionBid} from '@/lib/money';
import {listPublicResults} from '@/modules/auctions/results';
import {listAuctions,listCategories,serverNow} from '@/modules/auctions/catalog';
import styles from '@/components/home-banner.module.css';
function configuredVideo(){
 const raw=process.env.LOWIN_YOUTUBE_URL;if(!raw)return null;
 try{const u=new URL(raw);if(u.protocol!=='https:')return null;const id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com'].includes(u.hostname)?u.searchParams.get('v'):null;return id&&/^[A-Za-z0-9_-]{11}$/.test(id)?id:null}catch{return null}
}
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,query=parseBrowseQuery({sort:params.sort??'newest'}),now=await serverNow();
 const [categories,auctions,results,managed]=await Promise.all([listCategories(now),listAuctions(query,now,8),listPublicResults(db,{status:'winner',pageSize:6}),publicHomeContent()]);
 const winners=results.items.filter(item=>item.result?.source==='SETTLED'&&item.result.outcome==='WINNER'&&!item.isDemo);
 return <><OfflineRetry/><HomeHero copy={resolveHomeCopy(managed)} videoId={configuredVideo()}/><HomeCategories categories={categories} query={query}/>
  <Link className={styles.search} href={`/auctions/all?sort=${query.sort}#auction-search`}><Search/><span><MiniPhrase en="Find an auction" am="ጨረታ ይፈልጉ"/></span><small><MiniPhrase en="Search" am="ፈልግ"/></small></Link>
  <section id="discover-auctions" className={styles.section}><div className={styles.heading}><h2><MiniPhrase en="Discover auctions" am="ጨረታዎችን ያግኙ"/></h2><Link href={`/auctions/all?sort=${query.sort}`}><MiniPhrase en="View all" am="ሁሉንም"/><ArrowRight/></Link></div><AuctionSortLinks query={query} home/><div className={styles.statusLinks}><Link href={`/auctions/all?status=live&sort=${query.sort}`}><MiniPhrase en="Open now" am="አሁን ክፍት"/></Link><Link href={`/auctions/all?status=upcoming&sort=${query.sort}`}><MiniPhrase en="Coming soon" am="የሚመጡ"/></Link><Link href={`/auctions/all?status=closed&sort=${query.sort}`}><MiniPhrase en="Closed" am="የተዘጉ"/></Link></div>{auctions.items.length?<div className={styles.list}>{auctions.items.map(item=><AuctionCard key={item.code} auction={item} serverNow={now.toISOString()}/>)}</div>:<p className={styles.empty}><MiniPhrase en="New auctions will appear here when they are published. Come back soon." am="አዲስ ጨረታዎች ሲታተሙ እዚህ ይታያሉ። በቅርቡ ይመለሱ።"/></p>}</section>
  <section id="recent-winners" tabIndex={-1} className={styles.section} style={{scrollMarginTop:20}}><div className={styles.heading}><h2><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></h2><Link href="/draws"><MiniPhrase en="All draws" am="ሁሉም ውጤቶች"/><ArrowRight/></Link></div>{winners.length?<div className={styles.winnerGrid}>{winners.map(item=><Link href={`/auctions/${item.code}`} className={styles.winner} key={item.code}><CatalogImage src={item.product.images[0]?.path} alt=""/><div><h3><MiniPhrase en={item.product.title} am={item.product.titleAm||item.product.title}/></h3><strong><Trophy/> <MiniPhrase en="Confirmed winner" am="የተረጋገጠ አሸናፊ"/> {item.result?.winnerPhoneMasked??''}</strong><p><MiniPhrase en="Winning number" am="ያሸነፈው ቁጥር"/> {formatAuctionBid(item.result!.winningPoints??'0',item.terms.ruleVersion)}</p></div></Link>)}</div>:<p className={styles.empty}><MiniPhrase en="Confirmed winners will appear here after a draw is finalized. Explore Draws for completed and upcoming auctions." am="የተረጋገጡ አሸናፊዎች ውጤቱ ሲጠናቀቅ እዚህ ይታያሉ። የተጠናቀቁ እና የሚመጡ ጨረታዎችን በውጤቶች ይመልከቱ።"/></p>}</section>
  <section className={styles.help}><h2><MiniPhrase en="Your number. Your choice." am="የእርስዎ ቁጥር። የእርስዎ ምርጫ።"/></h2><p><MiniPhrase en="Understand the fee, the rules and how a winner is confirmed before you enter." am="ከመሳተፍዎ በፊት ክፍያውን፣ ደንቦቹን እና አሸናፊ እንዴት እንደሚረጋገጥ ይወቁ።"/></p><Link href="/faq"><MiniPhrase en="How bidding works" am="ጨረታ እንዴት ይሰራል"/><ArrowRight size={16}/></Link></section>
 </>;
}
