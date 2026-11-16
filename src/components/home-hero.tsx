'use client';
import {getImageProps} from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight,Trophy} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './home-banner.module.css';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import type {HomeExperience} from '@/modules/admin/content-schema';
import {FirstVisitIntroduction} from './first-visit-introduction';
import {lowwinHomeBanner,lowwinDesktopHomeBanner} from '@/lib/brand';
// Keep the current page visible while the sheet's code loads.
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'),{loading:()=>null});
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({copy,videoId,media,experience}:{copy:Copy;videoId?:string|null;media?:LearnMoreMedia|null;experience?:HomeExperience|null}){
 const [learn,setLearn]=useState(false);
 const learnButton=useRef<HTMLButtonElement>(null);
 const {language}=useMiniLocale();
 const headline=language==='am'?copy.headlineAm:copy.headline;
 const lead=language==='am'?copy.leadAm:copy.lead;
 const configuredBanner=language==='am'?experience?.bannerAm:experience?.bannerEn;
 const imageCommon={alt:language==='am'?'የLowWin ማስተዋወቂያ ምስል፤ ለማሳያ የተዘጋጀ':'LowWin promotional image; illustrative scene',quality:75,loading:'eager' as const,fetchPriority:'high' as const};
 const {props:mobile}=getImageProps({...imageCommon,src:lowwinHomeBanner(language,configuredBanner),width:1600,height:900,sizes:'(max-width:639px) 100vw, 900px'});
 const {props:desktop}=getImageProps({...imageCommon,src:lowwinDesktopHomeBanner(language,configuredBanner),width:1840,height:800,sizes:'(min-width:1280px) 1232px, calc(100vw - 48px)'});
 return <>
  <section className={`relative overflow-hidden ${styles.banner} ${styles.artworkBanner}`} aria-labelledby="home-headline" lang={language} data-home-hero>
   <div className={styles.bannerArtwork}>
    <picture><source media="(min-width:1024px)" srcSet={desktop.srcSet??desktop.src} sizes={desktop.sizes} width={1840} height={800}/><img {...mobile}/></picture>
   </div>
   <div aria-hidden="true" className={`absolute inset-0 bg-gradient-to-t from-foreground/70 via-foreground/25 to-transparent ${styles.bannerShade}`}/>
   <div className={styles.accessibleCopy}><h1 id="home-headline">{headline}</h1><p>{lead}</p></div>
   <div className={styles.introActions}>
    <button ref={learnButton} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button>
    <a href="#recent-winners" onClick={event=>{const section=document.getElementById('recent-winners');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><Trophy size={14}/><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></a>
   </div>
   <small className={styles.illustration}><MiniPhrase en="Illustrative scene" am="ለማሳያ የተዘጋጀ ምስል"/></small>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} returnFocusRef={learnButton}/>}
  <FirstVisitIntroduction enabled={!learn} media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined}/>
 </>;
}
