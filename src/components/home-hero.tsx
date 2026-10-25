'use client';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight,Trophy} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import styles from './home-banner.module.css';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
// Keep the current page visible while the sheet's code loads.
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'),{loading:()=>null});
type Copy={headline:string;headlineAm:string;lead:string;leadAm:string};
export function HomeHero({videoId,media}:{copy:Copy;videoId?:string|null;media?:LearnMoreMedia|null}){
 const [learn,setLearn]=useState(false);
 const learnButton=useRef<HTMLButtonElement>(null);
 const {language}=useMiniLocale();
 const headline=language==='am'?'ትንሽ ዋጋ። ትልቅ ደስታ።':'Small price. Big joy.';
 const lead=language==='am'?'ዝቅተኛና ያልተደገመ ዋጋ ያሸንፋል።':'The lowest unique bid wins.';
 return <>
  <section className={styles.banner} aria-labelledby="home-headline" lang={language}>
   <Image src={`/images/lowwin-home-banner-${language}.webp`} alt={language==='am'?'ለማሳያ የተዘጋጀ የኢትዮጵያ ቤተሰብ ከብስክሌት፣ ከቡና ማሽን እና ከሻንጣ ጋር':'Illustrative Ethiopian family with a bicycle, coffee machine and suitcase'} fill sizes="(max-width:480px) 100vw, 480px" quality={75} preload/>
   <div className="sr-only"><h1 id="home-headline">{headline}</h1><p>{lead}</p></div>
   <div className={styles.introActions}>
    <button ref={learnButton} type="button" onClick={()=>setLearn(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15}/></button>
    <a href="#recent-winners" onClick={event=>{const section=document.getElementById('recent-winners');if(section){event.preventDefault();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section.focus({preventScroll:true})}}}><Trophy size={14}/><MiniPhrase en="Recent winners" am="የቅርብ አሸናፊዎች"/></a>
   </div>
   <small className={styles.illustration}><MiniPhrase en="Illustrative scene" am="ለማሳያ የተዘጋጀ ምስል"/></small>
  </section>
  {learn&&<LearnMoreSheet onClose={()=>setLearn(false)} videoId={videoId} media={media} returnFocusRef={learnButton}/>}
 </>;
}
