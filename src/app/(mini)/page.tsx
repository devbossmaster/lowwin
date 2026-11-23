import {Suspense} from 'react';
import {HomePageContent,HomeDataSeed} from '@/components/home-page-content';
import {homeAuctionHref} from '@/lib/home-filter-query';
import {publicHomeContent,publicHomeExperience} from '@/modules/admin/public-content';
import {parseHomeQuery} from '@/modules/auctions/browse-query';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {listAuctions,listCategories,serverNow,type CatalogQuery} from '@/modules/auctions/catalog';
import {databaseErrorSummary} from '@/lib/database-error';
import {catalogProductPreview} from '@/lib/catalog-preview';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,query=parseHomeQuery(params);
 return <HomePageContent query={query}><Suspense fallback={null}><HomeServerData query={query}/></Suspense></HomePageContent>;
}
async function HomeServerData({query}:{query:CatalogQuery}){
 try{
 const clock=serverNow();
 // Recent winners use their own cache and loading boundary in the Home feed.
 const [categories,auctions,managed,experience,now]=await Promise.all([clock.then(at=>listCategories(at)),clock.then(at=>listAuctions(query,at,10)),publicHomeContent(),publicHomeExperience(),clock]);
 const media=resolveLearnMoreMedia(experience?.video??{youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <HomeDataSeed auctionHref={homeAuctionHref(query)} initial={{categories,auctions:{...auctions,items:auctions.items.map(catalogProductPreview)},managed,experience,media,serverNow:now.toISOString()}}/>;
 }catch(error){console.warn('home_data_unavailable',databaseErrorSummary(error));return <HomeDataSeed error/>}
}
