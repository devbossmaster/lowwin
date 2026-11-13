import type {Metadata} from 'next';
import {TutorialContent} from '@/components/tutorial-content';
import {publicHomeExperience} from '@/modules/admin/public-content';
import {resolveLearnMoreMedia} from '@/lib/learn-more-media';
import {requireCustomerPage} from '@/modules/auth/customer-page';
import styles from '@/components/tutorial.module.css';
export const metadata:Metadata={title:'How Lowwin works'};
export default async function HowItWorks(){
 await requireCustomerPage('/how-it-works');
 const experience=await publicHomeExperience().catch(()=>null);
 const media=resolveLearnMoreMedia(experience?.video??{youtube:process.env.LOWIN_YOUTUBE_URL,local:process.env.LOWIN_HOW_TO_VIDEO_PATH,poster:process.env.LOWIN_HOW_TO_POSTER_PATH});
 return <article className={styles.page}><TutorialContent media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined}/></article>;
}
