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
 {Icon:Hash,title:'Choose your number',titleAm:'ቁጥርዎን ይምረጡ',body:'Read the terms and choose a number. Entries stay private until the final result.',bodyAm:'ውሎቹን ያንብቡና ቁጥርዎን ይምረጡ። የቀረቡ ቁጥሮች ውጤቱ እስኪረጋገጥ ድረስ የግል ናቸው።'},
 {Icon:TicketCheck,title:'Confirm your entry',titleAm:'ክፍያውን ያረጋግጡ',body:'Review the submission fee and confirm your entry. Check My Bids for your receipt.',bodyAm:'የማስገቢያ ክፍያውን ይመልከቱና ያረጋግጡ። ደረሰኝዎን በ«ጨረታዎቼ» ይመልከቱ።'},
 {Icon:Trophy,title:'Lowest unique wins',titleAm:'ዝቅተኛው ልዩ ያሸንፋል',body:'The lowest number entered exactly once wins. View the confirmed result after closing.',bodyAm:'አንድ ጊዜ ብቻ የቀረበው ዝቅተኛ ቁጥር ያሸንፋል። ከመዝጊያ በኋላ የተረጋገጠውን ውጤት ይመልከቱ።'},
];
export function HomeHowItWorks({media,experience}:{media:LearnMoreMedia|null;experience?:HomeExperience|null}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),{language}=useMiniLocale();
 return <><section id="how-lowwin-works" aria-labelledby="how-bidding-title" className={styles.guide}>
  <header className={styles.heading}><h2 id="how-bidding-title"><MiniPhrase en="How bidding works" am="ጨረታው እንዴት ይሠራል"/></h2><p><MiniPhrase en="Three simple steps to take part." am="ለመሳተፍ ሶስት ቀላል ደረጃዎች።"/></p></header>
  <ol className={styles.steps}>{steps.map(({Icon,title,titleAm,body,bodyAm},index)=><li key={title}><div className={styles.illustration} aria-hidden="true"><Icon size={28} strokeWidth={1.65}/><span>{index+1}</span></div><div><h3><MiniPhrase en={title} am={titleAm}/></h3><p><MiniPhrase en={body} am={bodyAm}/></p></div></li>)}</ol>
  <div className={styles.example} role="group" aria-label={language==='am'?'የጨረታ ምሳሌ':'Bidding example'}><h3><MiniPhrase en="A quick example" am="ቀላል ምሳሌ"/></h3><div className={styles.numbers} role="group" aria-label="2, 2, 4, 5, 5">{[2,2,4,5,5].map((number,index)=><span key={index} data-example-number={number} data-winning-example={number===4||undefined} className={number===4?styles.winningNumber:styles.repeatedNumber}>{number===4&&<Trophy size={11} aria-hidden="true"/>}<strong>{number}</strong></span>)}</div><p><MiniPhrase en="4 wins: it is the lowest number picked once." am="4 አንድ ጊዜ ብቻ የቀረበ ዝቅተኛ ቁጥር ስለሆነ ያሸንፋል።"/></p></div>
  <p className={styles.rules}><MiniPhrase en="Fee-only auctions charge the submission fee, never your chosen number. Older auctions follow their published terms." am="በማስገቢያ ክፍያ ብቻ በሚካሄዱ ጨረታዎች፣ የመረጡት ቁጥር አይከፈልም። የቆዩ ጨረታዎች የታተሙ ውሎቻቸውን ይከተላሉ።"/></p>
  <div className={styles.actions}><button type="button" ref={trigger} aria-haspopup="dialog" onClick={()=>setOpen(true)}><MiniPhrase en="Learn more" am="ተጨማሪ ይወቁ"/><ArrowRight size={15} aria-hidden="true"/></button><Link href="/terms"><MiniPhrase en="Terms and conditions apply" am="ውሎችና ሁኔታዎች ይተገበራሉ"/></Link></div>
  {!!experience?.socials.length&&<nav className="managed-socials" aria-label="Lowwin social links">{experience.socials.map(s=><a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer">{s.platform}</a>)}</nav>}
 </section>{open&&<LearnMoreSheet media={media} intro={experience?{en:experience.learnIntroEn,am:experience.learnIntroAm}:undefined} onClose={()=>setOpen(false)} returnFocusRef={trigger}/>}</>;
}
