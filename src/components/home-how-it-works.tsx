'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import type {HomeExperience} from '@/modules/admin/content-schema';
import styles from './home-how-it-works.module.css';
// Keep the current page visible while the sheet's code loads.
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'),{loading:()=>null});
const steps=[
 {image:'choose-number',title:'Choose your number',titleAm:'ቁጥርዎን ይምረጡ',body:'Pick one or more numbers for an auction.',bodyAm:'ለጨረታው አንድ ወይም ብዙ ቁጥሮችን ይምረጡ።'},
 {image:'pay-entry',title:'Pay the entry fee',titleAm:'የማስገቢያ ክፍያውን ይክፈሉ',body:'Confirm the total with your wallet or payment provider.',bodyAm:'በዋሌትዎ ወይም በክፍያ አቅራቢዎ ይክፈሉ።'},
 {image:'winning-result',title:'See the result',titleAm:'ውጤቱን ይመልከቱ',body:'The lowest number picked once wins.',bodyAm:'አንድ ጊዜ ብቻ የቀረበው ዝቅተኛ ቁጥር ያሸንፋል።'},
];
export function HomeHowItWorks({media,experience}:{media:LearnMoreMedia|null;experience?:HomeExperience|null}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),section=useRef<HTMLElement>(null),[animate,setAnimate]=useState(false);
 useEffect(()=>{if(!section.current||matchMedia('(prefers-reduced-motion: reduce)').matches||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setAnimate(true);observer.disconnect()}},{threshold:.15});observer.observe(section.current);return()=>observer.disconnect()},[]);
 return <><section ref={section} id="how-lowwin-works" aria-labelledby="how-bidding-title" className={styles.guide} data-animate={animate||undefined}>
  <header className={styles.heading}><h2 id="how-bidding-title"><MiniPhrase en="How bidding works" am="ጨረታው እንዴት ይሠራል"/></h2></header>
  <ol className={styles.steps}>{steps.map(({image,title,titleAm,body,bodyAm},index)=><li key={image}><div className={styles.stepCopy}><h3><span className={styles.stepNumber} aria-hidden="true">{index+1}</span><MiniPhrase en={title} am={titleAm}/></h3><p><MiniPhrase en={body} am={bodyAm}/></p></div><img className={styles.illustration} src={`/images/how-it-works/${image}.svg`} width={260} height={170} loading="lazy" decoding="async" alt="" aria-hidden="true"/></li>)}</ol>
  <p className={styles.rules}><MiniPhrase en="Fee-only auctions: only the entry fee is charged." am="በክፍያ ብቻ ጨረታዎች፣ የማስገቢያ ክፍያው ብቻ ይከፈላል።"/></p>
  <div className={styles.actions}><button type="button" ref={trigger} aria-haspopup="dialog" onClick={()=>setOpen(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15} aria-hidden="true"/></button><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link></div>
 </section>{open&&<LearnMoreSheet media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
