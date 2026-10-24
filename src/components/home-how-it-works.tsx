'use client';
import dynamic from 'next/dynamic';
import {useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import type {LearnMoreMedia} from '@/lib/learn-more-media';
import styles from './home-banner.module.css';
const LearnMoreSheet=dynamic(()=>import('./learn-more-sheet'));
export function HomeHowItWorks({media}:{media:LearnMoreMedia|null}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 return <><section id="how-lowwin-works" className={styles.help}><h2><MiniPhrase en="How bidding works" am="ጨረታው እንዴት ይሠራል"/></h2><p><MiniPhrase en="Understand the fee, choose your number, and return for the final result." am="ክፍያውን ይረዱ፣ ቁጥርዎን ይምረጡ እና የመጨረሻ ውጤቱን ይመልከቱ።"/></p><button ref={trigger} className={styles.howAction} onClick={()=>setOpen(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={16}/></button></section>{open&&<LearnMoreSheet media={media} onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
