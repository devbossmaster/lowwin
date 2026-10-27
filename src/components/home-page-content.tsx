'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
import type {CatalogQuery,listAuctions,listCategories} from '@/modules/auctions/catalog';
import type {publicHomeContent,publicHomeExperience} from '@/modules/admin/public-content';
import type {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {catalogBatchUrl,winnersQueryUrl} from '@/lib/catalog-query';
import {HomeHero} from './home-hero';
import {MiniHeader} from './mini-header';
import {HomeCategories} from './home-categories';
import {HomeAuctions,homeAuctionHref} from './home-auctions';
import {HomeHowItWorks} from './home-how-it-works';
import {resolveHomeCopy} from './home-copy';
import {MiniPhrase} from './mini-locale';
import {OfflineRetry} from './offline-retry';
import {WinnersClientList,type WinnersData} from './winners-client-list';
import {isPrivateQueryIdentity,readPrivateQuery,seedPrivateQuery} from './private-query-cache';
import {useTelegram} from './telegram-provider';
import {CustomerLoading} from './loading-spinner';
import {customerLoadingCopy} from './customer-loading-copy';
import styles from './home-banner.module.css';

type Shell={managed:Awaited<ReturnType<typeof publicHomeContent>>;experience:Awaited<ReturnType<typeof publicHomeExperience>>;media:ReturnType<typeof resolveLearnMoreMedia>;serverNow:string};
export type HomeData=Shell&{categories:Awaited<ReturnType<typeof listCategories>>;auctions:Awaited<ReturnType<typeof listAuctions>>;winners:WinnersData};
type StreamedHome={initial?:HomeData;error?:boolean};
const HomeDataContext=createContext<((data:StreamedHome)=>void)|null>(null);
/** Server data updates the mounted Home, keeping open header sheets and focus. */
export function HomeDataSeed({initial,error}:StreamedHome){
 const receive=useContext(HomeDataContext);useEffect(()=>{receive?.({initial,error})},[receive,initial,error]);return null;
}
export function HomePageContent({query,children}:{query:CatalogQuery;children:ReactNode}){
 const [{initial,error},setStreamed]=useState<StreamedHome>({}),router=useRouter();
 const {queryIdentity}=useTelegram(),client=useQueryClient();
 const key=['lowin-private',queryIdentity??'pending','home-shell',homeAuctionHref(query)] as const;
 const shell=useQuery<Shell>({queryKey:key,enabled:false,staleTime:60000,gcTime:600000,initialData:queryIdentity&&initial?{managed:initial.managed,experience:initial.experience,media:initial.media,serverNow:initial.serverNow}:undefined});
 useEffect(()=>{if(!initial||!queryIdentity)return;const saved=client.getQueryData<Shell>(key);if(!saved||Date.parse(saved.serverNow)<Date.parse(initial.serverNow))client.setQueryData<Shell>(key,{managed:initial.managed,experience:initial.experience,media:initial.media,serverNow:initial.serverNow})},[initial,queryIdentity,client,key.join('|')]);
 const categories=initial?.categories??(queryIdentity?readPrivateQuery<HomeData['categories']>(queryIdentity,'/api/catalog/categories')?.value:null);
 const auctions=initial?.auctions??(queryIdentity?readPrivateQuery<HomeData['auctions']>(queryIdentity,catalogBatchUrl(query,1))?.value:null);
 const winners=initial?.winners??(queryIdentity?readPrivateQuery<WinnersData>(queryIdentity,winnersQueryUrl())?.value:null);
 const view=initial??shell.data;
 useEffect(()=>{if(initial&&queryIdentity&&isPrivateQueryIdentity(queryIdentity))seedPrivateQuery(queryIdentity,'/api/catalog/categories',initial.categories)},[initial,queryIdentity]);
 const failure=<p role="status"><MiniPhrase en="Home could not refresh." am="መነሻውን ማደስ አልተቻለም።"/> <button className="retry-action" onClick={()=>router.refresh()}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></p>;
 const content=!view||!categories||!auctions||!winners?(error?failure:<CustomerLoading {...customerLoadingCopy('/')}/>):<><OfflineRetry/>{error&&failure}<HomeHero copy={resolveHomeCopy(view.managed)} media={view.media} experience={view.experience}/>
  <HomeCategories categories={categories} query={query} home/><HomeAuctions key={`${query.category??'all'}:${query.sort}:${query.q}`} initial={auctions} query={query}/>
  <section id="recent-winners" tabIndex={-1} className={styles.winnersSection} style={{scrollMarginTop:20}}><div className={styles.heading}><h2><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></h2><Link href="/winners"><MiniPhrase en="View all" am="ሁሉንም ይመልከቱ"/><ArrowRight/></Link></div><WinnersClientList initial={winners} carousel/></section><HomeHowItWorks media={view.media} experience={view.experience}/>
 </>;
 return <><MiniHeader/>{content}<HomeDataContext.Provider value={setStreamed}>{children}</HomeDataContext.Provider></>;
}
