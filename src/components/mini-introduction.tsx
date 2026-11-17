import {publicHomeExperience} from '@/modules/admin/public-content';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {FirstVisitIntroduction} from './first-visit-introduction';

/** Stream public onboarding separately so it cannot delay account verification. */
export async function MiniIntroduction(){
 let experience:Awaited<ReturnType<typeof publicHomeExperience>>=null;
 try{experience=await publicHomeExperience()}catch{/* The short guide works during a public-content outage. */}
 const media=resolveLearnMoreMedia(experience?.video??{youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <FirstVisitIntroduction media={media}/>;
}
