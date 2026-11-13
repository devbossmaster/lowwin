'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useRef,useState} from 'react';
import {ArrowRight,Hash,TicketCheck,Trophy} from 'lucide-react';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import type {HomeExperience} from '@/modules/admin/content-schema';
import styles from './home-how-it-works.module.css';
// Keep the current page visible while the sheet's code loads.
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'),{loading:()=>null});
const steps=[
 {Icon:Hash,title:'Choose a number',titleAm:'ቁጥርዎን ይምረጡ'},
 {Icon:TicketCheck,title:'Pay the submission fee',titleAm:'ክፍያውን ይክፈሉ'},
 {Icon:Trophy,title:'Lowest unique number wins',titleAm:'ዝቅተኛው ልዩ ቁጥር ያሸንፋል'},
];
export function HomeHowItWorks({media,experience}:{media:LearnMoreMedia|null;experience?:HomeExperience|null}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),{language}=useMiniLocale();
 return <><section id="how-lowwin-works" aria-labelledby="how-bidding-title" className={styles.guide}>
  <header className={styles.heading}><h2 id="how-bidding-title"><MiniPhrase en="How bidding works" am="ጨረታው እንዴት ይሠራል"/></h2></header>
  <ol className={styles.steps}>{steps.map(({Icon,title,titleAm})=><li key={title}><div className={styles.symbol} aria-hidden="true"><Icon size={24} strokeWidth={1.7}/></div><div><h3><MiniPhrase en={title} am={titleAm}/></h3></div></li>)}</ol>
  <div className={styles.example} role="group" aria-label={language==='am'?'የጨረታ ምሳሌ':'Bidding example'}><div className={styles.numbers} role="group" aria-label="2, 2, 4, 5, 5">{[2,2,4,5,5].map((number,index)=><span key={index} data-example-number={number} data-winning-example={number===4||undefined} className={number===4?styles.winningNumber:styles.repeatedNumber}><strong>{number}</strong>{number===4&&<span className={styles.winnerLabel}><MiniPhrase en="Wins" am="አሸናፊ"/></span>}</span>)}</div></div>
  <p className={styles.rules}><MiniPhrase en="Fee-only auctions: only the entry fee is charged." am="በክፍያ ብቻ ጨረታዎች፣ የማስገቢያ ክፍያው ብቻ ይከፈላል።"/></p>
  <div className={styles.actions}><button type="button" ref={trigger} aria-haspopup="dialog" onClick={()=>setOpen(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15} aria-hidden="true"/></button><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link></div>
 </section>{open&&<LearnMoreSheet media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
