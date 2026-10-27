import {Suspense} from 'react';
import {HomePageContent,HomeDataSeed} from '@/components/home-page-content';
import {publicHomeContent,publicHomeExperience} from '@/modules/admin/public-content';
import {parseBrowseQuery} from '@/modules/auctions/browse-query';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {db} from '@/lib/db';
import {listCompletedWinners} from '@/modules/auctions/results';
import {stagingDemoEnabled} from '@/modules/auctions/staging-demo';
import {listAuctions,listCategories,serverNow,type CatalogQuery} from '@/modules/auctions/catalog';
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,query=parseBrowseQuery({...params,status:'live',sort:params.sort??'code',page:'1'});
 return <HomePageContent key={JSON.stringify(query)} query={query}><Suspense fallback={null}><HomeServerData query={query}/></Suspense></HomePageContent>;
}
async function HomeServerData({query}:{query:CatalogQuery}){
 try{
 const now=await serverNow();
 const [categories,auctions,winners,managed,experience]=await Promise.all([listCategories(now),listAuctions(query,now,10),listCompletedWinners(db,1,12),publicHomeContent(),publicHomeExperience()]);
 const media=resolveLearnMoreMedia(experience?.video??{youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <HomeDataSeed initial={{categories,auctions,winners:{...winners,allowDemo:stagingDemoEnabled()},managed,experience,media,serverNow:now.toISOString()}}/>;
 }catch{return <HomeDataSeed error/>}
}
