import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import {HomeHero} from '@/components/home-hero';
import {HomeCategories} from '@/components/home-categories';
import {HomeAuctions} from '@/components/home-auctions';
import {HomeHowItWorks} from '@/components/home-how-it-works';
import {resolveHomeCopy} from '@/components/home-copy';
import {publicHomeContent} from '@/modules/admin/public-content';
import {MiniPhrase} from '@/components/mini-locale';
import {parseBrowseQuery} from '@/modules/auctions/browse-query';
import {OfflineRetry} from '@/components/offline-retry';
import {WinnerCards} from '@/components/winner-cards';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {db} from '@/lib/db';
import {listCompletedWinners} from '@/modules/auctions/results';
import {listAuctions,listCategories,serverNow} from '@/modules/auctions/catalog';
import styles from '@/components/home-banner.module.css';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,query=parseBrowseQuery({...params,status:'live',sort:params.sort??'code',page:'1'}),now=await serverNow();
 const [categories,auctions,winners,managed]=await Promise.all([listCategories(now),listAuctions(query,now,10),listCompletedWinners(db,1,6),publicHomeContent()]);
 const media=resolveLearnMoreMedia({youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <><OfflineRetry/><HomeHero copy={resolveHomeCopy(managed)} media={media}/>
  <HomeCategories categories={categories} query={query} home/><HomeAuctions key={`${query.category??'all'}:${query.sort}:${query.q}`} initial={auctions} query={query}/>
  <section id="recent-winners" tabIndex={-1} className={styles.winnersSection} style={{scrollMarginTop:20}}><div className={styles.heading}><h2><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></h2><Link href="/winners"><MiniPhrase en="View all" am="ሁሉንም ይመልከቱ"/><ArrowRight/></Link></div><WinnerCards items={winners.items} carousel/></section><HomeHowItWorks media={media}/>
 </>;
}
