'use client';
import {ArrowUpRight,Send} from 'lucide-react';
import {AccountSheet} from './account-sheet';
import {MiniPhrase} from './mini-locale';
import type {TutorialProps} from './tutorial-content';
import {LOWWIN_BRAND_NAME,LOWWIN_LOGO_SRC} from '@/lib/brand';
import {TELEGRAM_CHANNEL_URL} from '@/lib/telegram-community';
import styles from './introduction-sheet.module.css';

/** Optional channel invitation; it never grants identity or gates browsing. */
export default function IntroductionSheet({onClose,onExplore}:TutorialProps&{onClose:()=>void;onExplore:()=>void}){
 return <AccountSheet title={<span className={styles.title}><img src={LOWWIN_LOGO_SRC} width={28} height={28} alt=""/><span>{LOWWIN_BRAND_NAME}</span></span>} presentation="centered" onClose={onClose}>
  <div className={styles.invite} data-telegram-channel-invite>
   <span className={styles.icon} aria-hidden="true"><Send size={27}/></span>
   <h3><MiniPhrase en="Join our Telegram channel" am="የቴሌግራም ቻናላችንን ይቀላቀሉ"/></h3>
   <p><MiniPhrase en="New prizes, auction updates and winner announcements, all in one place." am="አዳዲስ ሽልማቶችን፣ የጨረታ ዜናዎችን እና አሸናፊዎችን ይከታተሉ።"/></p>
   <a className={`primary-button ${styles.join}`} href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer" onClick={event=>{onExplore();const app=window.Telegram?.WebApp;if(app?.initData&&app.openTelegramLink){try{app.openTelegramLink(TELEGRAM_CHANNEL_URL);event.preventDefault()}catch{/* The normal HTTPS link remains available. */}}onClose()}}><MiniPhrase en="Join our Telegram channel" am="ቻናሉን ይቀላቀሉ"/><ArrowUpRight size={17} aria-hidden="true"/></a>
  </div>
 </AccountSheet>;
}
