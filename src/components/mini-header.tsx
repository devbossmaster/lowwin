'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Check,ChevronDown,Languages} from 'lucide-react';
import {AlertBell} from './alert-bell';
import {AuctionQuickList} from './auction-quick-list';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

export function MiniHeader(){
 const {language,setLanguage,t}=useMiniLocale();
 const [languageOpen,setLanguageOpen]=useState(false);
 const languageRef=useRef<HTMLDivElement>(null);
 const languageButtonRef=useRef<HTMLButtonElement>(null);
 const languageMenuRef=useRef<HTMLDivElement>(null),languageMenuId=useId();
 useEffect(()=>{
  if(!languageOpen)return;
  languageMenuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  const closeOutside=(event:PointerEvent)=>{if(!languageRef.current?.contains(event.target as Node))setLanguageOpen(false)};
  const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setLanguageOpen(false);languageButtonRef.current?.focus()}};
  document.addEventListener('pointerdown',closeOutside);
  document.addEventListener('keydown',closeEscape);
  return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape)};
 },[languageOpen]);
 const moveLanguageFocus=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
  const options=Array.from(languageMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]);
  const index=options.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();
   const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
   options[next]?.focus();
  }else if(event.key==='Tab'){setLanguageOpen(false);languageButtonRef.current?.focus()}
 };
 return <header className={styles.header} aria-label="Mini App header">
  <Link href="/" className={styles.brand} aria-label={language==='am'?'Lowin መነሻ':'Lowin Home'}><img src="/logo.png" width={43} height={43} alt=""/><span>Lowin</span></Link>
  <div className={styles.actions}>
  <AuctionQuickList className={`${styles.icon} ${styles.auctionShortcut}`} showLabel/>
  <AlertBell className={styles.icon}/>
  <div className={styles.language} ref={languageRef}>
   <button ref={languageButtonRef} type="button" className={styles.languageButton} aria-label={`${t('language')}: ${language==='en'?'English':'አማርኛ'}`} aria-haspopup="menu" aria-controls={languageMenuId} aria-expanded={languageOpen} onClick={()=>setLanguageOpen(open=>!open)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setLanguageOpen(true)}}}><Languages size={16} strokeWidth={1.75} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'EN':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={languageOpen} size={10} strokeWidth={1.75} aria-hidden="true"/></button>
   {languageOpen&&<div ref={languageMenuRef} id={languageMenuId} className={styles.languageMenu} role="menu" aria-label={t('language')} onKeyDown={moveLanguageFocus}>{([['en','English'],['am','አማርኛ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} lang={value} onClick={()=>{setLanguage(value as MiniLanguage);setLanguageOpen(false);languageButtonRef.current?.focus()}}><span>{label}</span>{language===value&&<Check size={15} strokeWidth={1.75} aria-hidden="true"/>}</button>)}</div>}
  </div>
  </div>
 </header>;
}
