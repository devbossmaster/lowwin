'use client';
import {useEffect,useState} from 'react';
import {Smartphone} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import {TutorialContent,type TutorialProps} from './tutorial-content';
import {LOWWIN_ICON_SRC} from '@/lib/brand';
import styles from './introduction-sheet.module.css';

/** Optional presentation only. Native shortcut approval never registers an account. */
export default function IntroductionSheet({media,intro,onClose}:TutorialProps&{onClose:()=>void}){
 const [step,setStep]=useState<'guide'|'shortcut'>('guide'),[shortcut,setShortcut]=useState(false),[requested,setRequested]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  const app=window.Telegram?.WebApp;
  if(!app?.addToHomeScreen||app.isVersionAtLeast&&!app.isVersionAtLeast('8.0'))return;
  let alive=true;setShortcut(true);
  try{app.checkHomeScreenStatus?.(status=>{if(alive&&(status==='added'||status==='unsupported'))setShortcut(false)})}catch{/* An available native method can still be offered. */}
  return()=>{alive=false};
 },[]);
 const next=()=>{if(step==='guide'&&shortcut)setStep('shortcut');else onClose()};
 function add(){try{window.Telegram?.WebApp?.addToHomeScreen?.();setRequested(true);setFailed(false)}catch{setFailed(true)}}
 return <AccountSheet title={<MiniPhrase en={step==='guide'?'How LowWin works':'LowWin on your home screen'} am={step==='guide'?'LowWin እንዴት ይሠራል':'LowWin በመነሻ ገጽዎ ላይ'}/>} presentation="centered" onClose={onClose} onBack={step==='guide'&&shortcut?next:undefined} onBeforeClose={step==='guide'&&shortcut?()=>{next();return true}:undefined} footer={<div className={styles.actions}>{step==='shortcut'&&!requested&&shortcut&&<button type="button" className="primary-button" onClick={add}><Smartphone size={18} aria-hidden="true"/><MiniPhrase en="Add to home screen" am="ወደ መነሻ ገጽ ያክሉ"/></button>}<button type="button" className={step==='guide'||requested?'primary-button':'text-link'} onClick={next}><MiniPhrase en={step==='guide'?'Continue':requested?'Continue':'Skip for now'} am={step==='guide'?'ቀጥል':requested?'ቀጥል':'ለአሁኑ ይዝለሉ'}/></button></div>}>
  <div className={styles.invite} data-mini-introduction={step}>
   {step==='guide'?media?<TutorialContent media={media} intro={intro}/>:<><p><MiniPhrase en="Choose a number. The lowest number picked by one player wins." am="ቁጥር ይምረጡ። በአንድ ሰው ብቻ የተመረጠው ዝቅተኛው ቁጥር ያሸንፋል።"/></p><ol className={styles.steps}><li><MiniPhrase en="Choose an auction and your numbers." am="ጨረታ እና ቁጥሮችዎን ይምረጡ።"/></li><li><MiniPhrase en="Review and pay the entry fee for each number." am="ይገምግሙ እና ለእያንዳንዱ ቁጥር የመግቢያ ክፍያውን ይክፈሉ።"/></li><li><MiniPhrase en="Check My Bids for your result. If no unique number remains, the auction is cancelled and actual paid fees return to your wallet." am="ውጤትዎን በጨረታዎቼ ይመልከቱ። ልዩ ቁጥር ከሌለ ጨረታው ይሰረዛል፣ የተከፈለውም ክፍያ ወደ ዋሌትዎ ይመለሳል።"/></li></ol></>:<><img className={styles.shortcutIcon} src={LOWWIN_ICON_SRC} width={80} height={80} alt="LowWin"/><h3><MiniPhrase en="Open LowWin in one tap" am="LowWinን በአንድ ንክኪ ይክፈቱ"/></h3><p><MiniPhrase en={requested?'Confirm in Telegram, then continue. You can also skip this step.':'Add an optional shortcut to your phone’s home screen.'} am={requested?'በTelegram ያረጋግጡ፣ ከዚያ ይቀጥሉ። ይህን ደረጃ መዝለልም ይችላሉ።':'አማራጭ አቋራጭ ወደ ስልክዎ መነሻ ገጽ ያክሉ።'}/></p>{failed&&<p role="status"><MiniPhrase en="This shortcut is unavailable. You can continue without it." am="ይህ አቋራጭ አይገኝም። ያለ አቋራጩ መቀጠል ይችላሉ።"/></p>}</>}
  </div>
 </AccountSheet>;
}
