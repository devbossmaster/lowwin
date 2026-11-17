'use client';
import {getImageProps} from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './home-banner.module.css';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import type {HomeExperience} from '@/modules/admin/content-schema';
import {lowwinHomeBanner} from '@/lib/brand';
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
 const {props:image}=getImageProps({alt:language==='am'?'ለማሳያ የተዘጋጁ PS5፣ በሳጥን ያለ iPhone 17 Pro Max፣ BYD Seagull መኪና እና ጭማቂ መጭመቂያ':'Illustrative PS5, boxed iPhone 17 Pro Max, BYD Seagull car and juicer',quality:75,loading:'eager',fetchPriority:'high',src:lowwinHomeBanner(language,configuredBanner),width:1840,height:800,sizes:'(min-width:1280px) 1232px, (min-width:1024px) calc(100vw - 48px), 167vw'});
 return <>
  <section className={`relative overflow-hidden ${styles.banner} ${styles.artworkBanner}`} aria-labelledby="home-headline" lang={language} data-home-hero>
   <div className={styles.bannerArtwork} data-hero-artwork><img {...image}/></div>
   <div className={styles.bannerCopy} data-hero-copy><h1 id="home-headline">{headline}</h1><p>{lead}</p>
   <div className={styles.introActions}>
    <a className={styles.liveAction} href="#discover-auctions" onClick={event=>{const section=document.getElementById('discover-auctions');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><MiniPhrase en="Live auctions" am="ክፍት ጨረታዎች"/><ArrowRight size={16}/></a>
    <button ref={learnButton} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button>
   </div></div>
   <small className={styles.illustration}><MiniPhrase en="Illustrative scene" am="ለማሳያ የተዘጋጀ ምስል"/></small>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} returnFocusRef={learnButton}/>}
 </>;
}
