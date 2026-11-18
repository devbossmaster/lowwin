'use client';
import {getImageProps} from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import styles from './home-banner.module.css';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import type {HomeExperience} from '@/modules/admin/content-schema';
import {lowwinHomeBanner,lowwinMobileHomeBanner} from '@/lib/brand';
// Keep the current page visible while the sheet's code loads.
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'),{loading:()=>null});
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({copy,videoId,media,experience}:{copy:Copy;videoId?:string|null;media?:LearnMoreMedia|null;experience?:HomeExperience|null}){
 const [learn,setLearn]=useState(false);
 const learnButton=useRef<HTMLButtonElement>(null);
 const {language}=useMiniLocale();
 const {environment}=useTelegram();
 const headline=language==='am'?copy.headlineAm:copy.headline;
 const lead=language==='am'?copy.leadAm:copy.lead;
 const headlineParts=headline.match(/^(.+?[.!።])\s+([\s\S]+)$/);
 const configuredBanner=language==='am'?experience?.bannerAm:experience?.bannerEn;
 const alt=language==='am'?'ለማሳያ የተዘጋጀ ቤተሰብ በቤት ውስጥ፣ በሳጥን ያሉ PS5 እና iPhone Pro Max ይዞ፣ ከሰማያዊ ሻንጣና ሌሎች መሣሪያዎች ጋር':'Illustrative family at home holding boxed PS5 and iPhone Pro Max, with blue luggage and gadgets';
 const {props:image}=getImageProps({alt,quality:75,loading:'eager',fetchPriority:'high',src:lowwinHomeBanner(language,configuredBanner),width:1840,height:800,sizes:'(min-width:1280px) 1232px, (min-width:1024px) calc(100vw - 48px), 100vw'});
 const {props:mobileImage}=getImageProps({alt,quality:75,src:lowwinMobileHomeBanner(language,configuredBanner),width:900,height:1350,sizes:'(min-width:640px) 480px, 100vw'});
 return <>
  <section className={`relative overflow-hidden ${styles.banner} ${styles.artworkBanner}`} aria-labelledby="home-headline" lang={language} data-home-hero>
   <div className={styles.bannerMain}>
   <div className={styles.bannerArtwork} data-hero-artwork><picture><source media={environment==='mini'?'all':'(max-width:639px)'} srcSet={mobileImage.srcSet} sizes={mobileImage.sizes}/><img {...image}/></picture></div>
   <div className={styles.bannerCopy} data-hero-copy><h1 id="home-headline">{headlineParts?<><span>{headlineParts[1]}</span>{' '}<span className={styles.headlineAccent}>{headlineParts[2]}</span></>:headline}</h1><p>{lead}</p></div>
   <div className={styles.introActions}>
    <a className={styles.liveAction} href="#discover-auctions" onClick={event=>{const section=document.getElementById('discover-auctions');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><MiniPhrase en="Live auctions" am="ክፍት ጨረታዎች"/><ArrowRight size={16}/></a>
    <button ref={learnButton} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button>
   </div>
   </div>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} returnFocusRef={learnButton}/>}
 </>;
}
