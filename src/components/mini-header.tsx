'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Globe2,UserRound} from 'lucide-react';
import {Button} from './ui/button';
import {AlertBell} from './alert-bell';
import {AuctionQuickList} from './auction-quick-list';
import {useTelegram} from './telegram-provider';
import {formatEtb} from '@/lib/money';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

export function MiniHeader(){
 const {me,status}=useTelegram();
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
 const photo=status==='authenticated'&&me?.user.image?.startsWith('https://')?me.user.image:null;
 const available=status==='authenticated'?me?.wallet?.available:undefined;
 const valid=typeof available==='string'&&/^\d+$/.test(available);
 const amount=valid?formatEtb(available):null;
 const label=status==='loading'?t('loading'):status==='guest'||status==='contact-required'?t('signIn'):t('unavailable');
 const demo=status==='authenticated'&&me?.wallet?.demo;
 return <header className={styles.header} aria-label="Mini App header">
  <Button asChild variant="outline" className={styles.avatar}><Link href="/profile" aria-label={t('openProfile')}><UserRound size={22} aria-hidden="true"/>{photo&&<img key={photo} src={photo} alt="" width={40} height={40} referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/>}</Link></Button>
  <Button asChild variant="outline" className={styles.balance}><Link href="/wallet" title={amount??label} aria-label={amount?`${demo?'DEMO ':''}${amount} ${t('available')}, ${t('openWallet')}`:`${label}, ${t('openWallet')}`} aria-busy={status==='loading'}>
   <span className={styles.balanceLabel}>{demo?'DEMO · ':''}{t('available')}</span>
   <span className={styles.amount}>{amount&&<small>ETB </small>}{amount?amount.replace('ETB ',''):label}</span>
  </Link></Button>
  <AlertBell className={styles.icon}/>
  <AuctionQuickList className={styles.icon}/>
  <div className={styles.language} ref={languageRef}>
   <button ref={languageButtonRef} type="button" className={styles.languageButton} aria-label={t('language')} aria-haspopup="menu" aria-expanded={languageOpen} onClick={()=>setLanguageOpen(open=>!open)}><Globe2 size={16} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'En':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={languageOpen} size={12} aria-hidden="true"/></button>
   {languageOpen&&<div className={styles.languageMenu} role="menu" aria-label={t('language')}>{([['en','En'],['am','አማ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} onClick={()=>{setLanguage(value as MiniLanguage);setLanguageOpen(false);languageButtonRef.current?.focus()}}><span>{label}</span>{language===value&&<Check size={14} aria-hidden="true"/>}</button>)}</div>}
  </div>
 </header>;
}
