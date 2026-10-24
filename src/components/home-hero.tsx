'use client';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight,Trophy} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './home-banner.module.css';
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'));
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({copy,videoId}:{copy:Copy;videoId:string|null}){
 const [learn,setLearn]=useState(false);
 const learnButton=useRef<HTMLButtonElement>(null);
 const {language}=useMiniLocale();
 const headline=language==='am'?copy.headlineAm:copy.headline;
 const highlightAt=headline.lastIndexOf(' ')+1;
 return <>
  <section className={styles.banner} aria-labelledby="home-headline" lang={language}>
   <Image src="/images/lowin-family-hero.webp" alt="An illustrative Ethiopian family celebrating together with a bicycle, coffee machine and suitcase" fill sizes="(max-width:480px) 100vw, 480px" quality={75} preload/>
   <div className={styles.bannerShade} aria-hidden="true"/>
   <div className={styles.bannerCopy}>
    <h1 id="home-headline">{headline.slice(0,highlightAt)}<span>{headline.slice(highlightAt)}</span></h1>
    <p><MiniPhrase en="The lowest unique bid wins." am="ዝቅተኛው ልዩ ቁጥር ያሸንፋል።"/></p>
   </div>
   <div className={styles.introActions}>
    <button ref={learnButton} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button>
    <a href="#recent-winners" onClick={event=>{const section=document.getElementById('recent-winners');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><Trophy size={14}/><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></a>
   </div>
   <small className={styles.illustration}><MiniPhrase en="Illustrative scene" am="ለማሳያ የተዘጋጀ ምስል"/></small>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} returnFocusRef={learnButton}/>}
 </>;
}
