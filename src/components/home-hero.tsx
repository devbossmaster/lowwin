'use client';
import {getImageProps} from 'next/image';
import dynamic from 'next/dynamic';
import Link from 'next/link';
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
 const headlineParts=headline.match(/^(.+?[.!።])\s+([\s\S]+)$/);
 const leadParts=lead.match(/^(The lowest unique|ዝቅተኛና ያልተደገመ)\s+([\s\S]+)$/);
 const configuredBanner=language==='am'?experience?.bannerAm:experience?.bannerEn;
 const alt=language==='am'?'ለማሳያ የተዘጋጀ ቤተሰብ በቤት ውስጥ፣ በሳጥን ያሉ PS5 እና iPhone Pro Max ይዞ፣ ከሰማያዊ ሻንጣና ሌሎች መሣሪያዎች ጋር':'Illustrative family at home holding boxed PS5 and iPhone Pro Max, with blue luggage and gadgets';
 const {props:image}=getImageProps({alt,quality:75,loading:'eager',fetchPriority:'high',src:lowwinHomeBanner(language,configuredBanner),width:1840,height:800,sizes:'(max-width: 430px) 100vw, 430px'});
 return <>
  <section className={`relative overflow-hidden ${styles.banner} ${styles.artworkBanner}`} aria-labelledby="home-headline" lang={language} data-home-hero>
   <div className={styles.bannerMain}>
   <div className={styles.bannerArtwork} data-hero-artwork><img {...image}/></div>
   <div className={styles.bannerCopy} data-hero-copy><h1 id="home-headline">{headlineParts?<><span>{headlineParts[1]}</span>{' '}<span className={styles.headlineAccent}>{headlineParts[2]}</span></>:headline}</h1><p>{leadParts?<><span>{leadParts[1]}</span>{' '}<span>{leadParts[2]}</span></>:lead}</p></div>
   <div className={styles.introActions}>
    <button ref={learnButton} className={styles.liveAction} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="How it works?" am="እንዴት ይሠራል?"/><ArrowRight size={16}/></button>
    <Link href="/winners"><MiniPhrase en="Winners" am="አሸናፊዎች"/><ArrowRight size={15}/></Link>
   </div>
   </div>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} returnFocusRef={learnButton}/>}
 </>;
}
