'use client';
import Link from 'next/link';
import Image from 'next/image';
import {ArrowRight,Check,Info} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {TutorialVideo} from './tutorial-video';
import type {TutorialProps} from './tutorial-content';
import {LOWWIN_LOGO_SRC,lowwinBanner} from '@/lib/brand';
import styles from './introduction-sheet.module.css';
export default function IntroductionSheet({onClose,onExplore,media,intro}:TutorialProps&{onClose:()=>void;onExplore:()=>void}){
 const {language}=useMiniLocale(),am=language==='am';
 return <AccountSheet title={<span className={styles.title}><img src={LOWWIN_LOGO_SRC} width={32} height={32} alt=""/><span><MiniPhrase en="Welcome to LowWin" am="ወደ LowWin እንኳን በደህና መጡ"/></span></span>} onClose={onClose} footer={<button className={`primary-button ${styles.continue}`} type="button" onClick={onClose}><MiniPhrase en="Continue to auctions" am="ወደ ጨረታዎች ይቀጥሉ"/><ArrowRight size={17} aria-hidden="true"/></button>}>
  <div className={styles.introduction} data-welcome-introduction>
   {media?<TutorialVideo media={media}/>:<div className={styles.artwork}><Image src={lowwinBanner(language)} alt="" fill sizes="(max-width:480px) calc(100vw - 36px),444px" quality={75}/></div>}
   <p className={styles.lead}><MiniPhrase en={intro?.en||'Choose your bid amount. The lowest amount entered by just one player wins.'} am={intro?.am||'የጨረታ መጠንዎን ይምረጡ። በአንድ ተጫራች ብቻ የተመረጠው ዝቅተኛ መጠን ያሸንፋል።'}/></p>
   <section className={styles.example} aria-label={am?'የማብራሪያ ምሳሌ':'Illustrative bid example'}>
    <h3><MiniPhrase en="See how a unique bid wins" am="ልዩ ጨረታ እንዴት እንደሚያሸንፍ ይመልከቱ"/></h3>
    <div className={styles.numbers}>
     <div><strong>1.25</strong><span><MiniPhrase en="2 bids" am="2 ጨረታዎች"/></span></div>
     <div data-example-winner><strong>1.26<Check size={13} aria-hidden="true"/></strong><span><MiniPhrase en="1 bid · wins" am="1 ጨረታ · ያሸንፋል"/></span></div>
     <div><strong>1.30</strong><span><MiniPhrase en="1 bid" am="1 ጨረታ"/></span></div>
    </div>
   </section>
   <p className={styles.fine}><Info size={16} aria-hidden="true"/><span><MiniPhrase en="Browse freely. Check each auction’s fee and rules before you enter." am="በነፃ ይመልከቱ። ከመጫረትዎ በፊት የእያንዳንዱን ጨረታ ክፍያ እና ደንቦች ያንብቡ።"/></span></p>
   <Link href="/how-it-works" onNavigate={onExplore} className={styles.more}><MiniPhrase en="Read how Lowwin works" am="Lowwin እንዴት እንደሚሠራ ያንብቡ"/><ArrowRight size={15} aria-hidden="true"/></Link>
  </div>
 </AccountSheet>;
}
