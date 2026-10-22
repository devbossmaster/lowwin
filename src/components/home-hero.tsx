'use client';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight,Trophy} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './home-banner.module.css';
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'));
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({copy,videoId}:{copy:Copy;videoId:string|null}){
 const [learn,setLearn]=useState(false),learnTrigger=useRef<HTMLButtonElement>(null);
 return <>
  <section className={styles.banner} aria-label="Lowin"><Image src="/images/lowin-family-hero.webp" alt="An illustrative Ethiopian family celebrating together with a bicycle, coffee machine and suitcase" fill sizes="(max-width:480px) 100vw, 480px" quality={80} preload/><div className={styles.bannerShade}/><div className={styles.bannerCopy}><h2><MiniPhrase en={'Small numbers.\nBig possibilities.'} am={'ትንሽ ቁጥር።\nትልቅ ዕድል።'}/></h2><span><MiniPhrase en="Find your next favourite." am="የሚወዱትን ዕቃ ያግኙ።"/></span></div><small className={styles.illustration}><MiniPhrase en="Illustrative scene" am="ለማሳያ የተዘጋጀ ምስል"/></small></section>
  <section className={styles.intro} aria-labelledby="home-headline"><h1 id="home-headline"><MiniPhrase en={copy.headline} am={copy.headlineAm}/></h1><p><MiniPhrase en={copy.lead} am={copy.leadAm}/></p><div className={styles.introActions}><button ref={learnTrigger} onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button><a href="#recent-winners" onClick={event=>{const section=document.getElementById('recent-winners');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><Trophy size={14}/><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></a></div></section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} returnFocusRef={learnTrigger}/>}
 </>;
}
