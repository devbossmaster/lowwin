'use client';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {skipToken,useQuery,useQueryClient} from '@tanstack/react-query';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
import type {CatalogQuery,listAuctions,listCategories} from '@/modules/auctions/catalog';
import type {publicHomeContent,publicHomeExperience} from '@/modules/admin/public-content';
import type {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {catalogBatchUrl,recentWinnersQueryUrl} from '@/lib/catalog-query';
import {homeFilterQuery} from '@/lib/home-filter-query';
import {HomeHero} from './home-hero';
import {MiniHeader} from './mini-header';
import {HomeCategories} from './home-categories';
import {HomeAuctions,homeAuctionHref} from './home-auctions';
import {HomeHowItWorks} from './home-how-it-works';
import {HomeFooter} from './home-footer';
import {resolveHomeCopy} from './home-copy';
import {MiniPhrase} from './mini-locale';
import {OfflineRetry} from './offline-retry';
import {WinnersClientList,type WinnersData} from './winners-client-list';
import {readPublicQuery,seedPublicQuery} from './public-query-cache';

import {MiniRouteSkeleton} from './mini-route-skeleton';
import styles from './home-banner.module.css';

type Shell={managed:Awaited<ReturnType<typeof publicHomeContent>>;experience:Awaited<ReturnType<typeof publicHomeExperience>>;media:ReturnType<typeof resolveLearnMoreMedia>;serverNow:string};
export type HomeData=Shell&{categories:Awaited<ReturnType<typeof listCategories>>;auctions:Awaited<ReturnType<typeof listAuctions>>;winners:WinnersData};
type StreamedHome={initial?:HomeData;error?:boolean;auctionHref?:string};
const HomeDataContext=createContext<((data:StreamedHome)=>void)|null>(null);
/** Server data updates the mounted Home, keeping open header sheets and focus. */
export function HomeDataSeed({initial,error,auctionHref}:StreamedHome){
 const receive=useContext(HomeDataContext);useEffect(()=>{receive?.({initial,error,auctionHref})},[receive,initial,error,auctionHref]);return null;
}
export function HomePageContent({query:seedQuery,children}:{query:CatalogQuery;children:ReactNode}){
 const query=homeFilterQuery(useSearchParams());
 const [{initial,error,auctionHref},setStreamed]=useState<StreamedHome>({}),router=useRouter();
 const client=useQueryClient();
 const key=['lowin-public','home-shell'] as const;
 const shell=useQuery<Shell>({queryKey:key,queryFn:skipToken,enabled:false,staleTime:60000,gcTime:600000,initialData:initial?{managed:initial.managed,experience:initial.experience,media:initial.media,serverNow:initial.serverNow}:undefined});
 useEffect(()=>{if(!initial)return;const saved=client.getQueryData<Shell>(key);if(!saved||Date.parse(saved.serverNow)<Date.parse(initial.serverNow))client.setQueryData<Shell>(key,{managed:initial.managed,experience:initial.experience,media:initial.media,serverNow:initial.serverNow})},[initial,client,key.join('|')]);
 const categories=initial?.categories??readPublicQuery<HomeData['categories']>('/api/catalog/categories')?.value;
 const auctions=(homeAuctionHref(query)===(auctionHref??homeAuctionHref(seedQuery))?initial?.auctions:undefined)??readPublicQuery<HomeData['auctions']>(catalogBatchUrl(query,1))?.value;
 const winners=initial?.winners??readPublicQuery<WinnersData>(recentWinnersQueryUrl())?.value;
 const view=initial??shell.data;
 useEffect(()=>{if(initial)seedPublicQuery('/api/catalog/categories',initial.categories)},[initial]);
 const content=<HomePageSections view={view} categories={categories} auctions={auctions} winners={winners} query={query} error={!!error} onRetry={()=>router.refresh()}/>;
 return <><div className="home-header-slot" hidden={(!view||!categories||!winners)&&!error}><MiniHeader/></div>{content}<HomeDataContext.Provider value={setStreamed}>{children}</HomeDataContext.Provider></>;
}

/** The public shell remains useful during an outage. Missing resources are
 * unavailable, never empty results; only successful server data enters caches. */
export function HomePageSections({view,categories,auctions,winners,query,error,onRetry}:{view?:Shell;categories?:HomeData['categories'];auctions?:HomeData['auctions'];winners?:WinnersData;query:CatalogQuery;error:boolean;onRetry:()=>void}){
 if((!view||!categories||!winners)&&!error)return <MiniRouteSkeleton path="/"/>;
 return <><OfflineRetry/>{error&&<div role="status" className={styles.homeNotice}><p><MiniPhrase en="Home could not refresh. Please try again." am="መነሻውን ማደስ አልተቻለም። እንደገና ይሞክሩ።"/></p><HomeRetry onRetry={onRetry}/></div>}
  <HomeHero copy={resolveHomeCopy(view?.managed??null)} media={view?.media??null} experience={view?.experience??null}/>
  {categories&&<HomeCategories categories={categories} query={query} home/>}
  {error&&!auctions?<section id="discover-auctions" className={styles.section} data-home-unavailable="auctions"><div className={styles.heading}><h2><MiniPhrase en="Live auctions" am="ክፍት ጨረታዎች"/></h2></div><div className={styles.unavailable}><p><MiniPhrase en="Live auctions are temporarily unavailable." am="ክፍት ጨረታዎችን ለጊዜው ማምጣት አልተቻለም።"/></p><HomeRetry onRetry={onRetry}/></div></section>:<HomeAuctions key={[query.category??'all',query.sort,query.q].join(':')} initial={auctions} query={query}/>}
  <section id="recent-winners" tabIndex={-1} className={styles.winnersSection} style={{scrollMarginTop:20}}><div className={styles.heading}><h2><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></h2><Link href="/winners"><MiniPhrase en="View all" am="ሁሉንም ይመልከቱ"/><ArrowRight/></Link></div>{error&&!winners?<div className={styles.unavailableWinners} data-home-unavailable="winners"><div className={styles.unavailable}><p><MiniPhrase en="Recent winners are temporarily unavailable." am="የቅርብ አሸናፊዎችን ለጊዜው ማምጣት አልተቻለም።"/></p><HomeRetry onRetry={onRetry}/></div></div>:<WinnersClientList initial={winners} carousel/>}</section>
  <HomeHowItWorks media={view?.media??null} experience={view?.experience??null}/><HomeFooter/>
 </>;
}
function HomeRetry({onRetry}:{onRetry:()=>void}){return <button type="button" className={styles.homeRetry} onClick={onRetry}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button>}
