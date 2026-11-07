'use client';
import Link from 'next/link';
import {ArrowRight} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import {TutorialVideo} from './tutorial-video';
import type {TutorialProps} from './tutorial-content';
import styles from './tutorial.module.css';
export default function IntroductionSheet({onClose,media,intro}:TutorialProps&{onClose:()=>void}){
 return <AccountSheet title={<MiniPhrase en="Welcome to Lowwin" am="ወደ Lowwin እንኳን በደህና መጡ"/>} onClose={onClose} footer={<button className="primary-button" type="button" onClick={onClose}><MiniPhrase en="Continue to auctions" am="ወደ ጨረታዎች ይቀጥሉ"/><ArrowRight size={16} aria-hidden="true"/></button>}>
  <div className={styles.introduction}><p className={styles.lead}><MiniPhrase en={intro?.en||'A little different wins. Choose a bid amount—the lowest amount entered by just one player wins.'} am={intro?.am||'ትንሽ ልዩነት ያሸንፋል። የጨረታ መጠን ይምረጡ፤ በአንድ ተጫራች ብቻ የተመረጠው ዝቅተኛ መጠን ያሸንፋል።'}/></p><TutorialVideo media={media??null}/><p className={styles.fine}><MiniPhrase en="Browse freely. Check each auction’s fee and rules before you enter." am="በነፃ ይመልከቱ። ከመጫረትዎ በፊት የእያንዳንዱን ጨረታ ክፍያ እና ደንቦች ያንብቡ።"/></p><Link href="/how-it-works" onClick={onClose} className={styles.more}><MiniPhrase en="Read how Lowwin works" am="Lowwin እንዴት እንደሚሠራ ያንብቡ"/><ArrowRight size={14} aria-hidden="true"/></Link></div>
 </AccountSheet>;
}
