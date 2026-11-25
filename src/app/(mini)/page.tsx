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
 const clock=serverNow();
 return <HomePageContent query={query}>
  <Suspense fallback={null}><HomeShellData clock={clock}/></Suspense>
  <Suspense fallback={null}><HomeAuctionData query={query} clock={clock}/></Suspense>
 </HomePageContent>;
}
async function HomeShellData({clock}:{clock:Promise<Date>}){
 try{
 const [categories,managed,experience,now]=await Promise.all([clock.then(at=>listCategories(at)),publicHomeContent(),publicHomeExperience(),clock]);
 const media=resolveLearnMoreMedia(experience?.video??{youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <HomeDataSeed data={{initial:{categories,managed,experience,media,serverNow:now.toISOString()},error:false}}/>;
 }catch(error){console.warn('home_data_unavailable',databaseErrorSummary(error));return <HomeDataSeed data={{error:true}}/>}
}
async function HomeAuctionData({clock,query}:{clock:Promise<Date>;query:CatalogQuery}){
 const href=homeAuctionHref(query);
 try{
  const auctions=await listAuctions(query,await clock,10);
  return <HomeDataSeed data={{batch:{href,auctions:{...auctions,items:auctions.items.map(catalogProductPreview)}}}}/>;
 }catch(error){
  console.warn('home_auctions_unavailable',databaseErrorSummary(error));
  return <HomeDataSeed data={{batch:{href,failed:true}}}/>;
 }
}
