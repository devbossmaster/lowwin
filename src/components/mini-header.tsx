'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Globe2} from 'lucide-react';
import {AlertBell} from './alert-bell';
import {AuctionQuickList} from './auction-quick-list';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

export function MiniHeader(){
 const {language,setLanguage,t}=useMiniLocale();
 const [languageOpen,setLanguageOpen]=useState(false);
 const languageRef=useRef<HTMLDivElement>(null);
 const languageButtonRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!languageOpen)return;
  const closeOutside=(event:PointerEvent)=>{if(!languageRef.current?.contains(event.target as Node))setLanguageOpen(false)};
  const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setLanguageOpen(false);languageButtonRef.current?.focus()}};
  document.addEventListener('pointerdown',closeOutside);
  document.addEventListener('keydown',closeEscape);
  return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape)};
 },[languageOpen]);
 return <header className={styles.header} aria-label="Mini App header">
  <Link href="/" className={styles.brand} aria-label="Lowin Home"><img src="/logo.png" width={46} height={46} alt=""/><span>Lowin</span></Link>
  <span className={styles.spacer}/>
  <AuctionQuickList className={styles.icon}/>
  <AlertBell className={styles.icon}/>
  <div className={styles.language} ref={languageRef}>
   <button ref={languageButtonRef} type="button" className={styles.languageButton} aria-label={t('language')} aria-haspopup="menu" aria-expanded={languageOpen} onClick={()=>setLanguageOpen(open=>!open)}><Globe2 size={16} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'En':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={languageOpen} size={12} aria-hidden="true"/></button>
   {languageOpen&&<div className={styles.languageMenu} role="menu" aria-label={t('language')}>{([['en','En'],['am','አማ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} onClick={()=>{setLanguage(value as MiniLanguage);setLanguageOpen(false);languageButtonRef.current?.focus()}}><span>{label}</span>{language===value&&<Check size={14} aria-hidden="true"/>}</button>)}</div>}
  </div>
 </header>;
}
