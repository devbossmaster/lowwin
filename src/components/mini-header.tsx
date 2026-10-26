'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Check,ChevronDown,Languages,Plus,UserRound,Wallet} from 'lucide-react';
import {AlertBell} from './alert-bell';
import {AuctionQuickList} from './auction-quick-list';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery} from './private-query';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {WalletBalance} from '@/modules/wallet/balance';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

export function MiniHeader(){
 const {language,setLanguage,t}=useMiniLocale();
 const {status,me}=useTelegram(),am=language==='am';
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000,pollMs:60000});
 const [failedPhoto,setFailedPhoto]=useState<string|null>(null);
 const name=status==='authenticated'?me?.user.name.trim()??'':'';
 const initials=name.split(/\s+/u).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase();
 const photo=status==='authenticated'&&me?.user.image?.startsWith('https://')&&failedPhoto!==me.user.image?me.user.image:null;
 let amount:string|null=null;
 try{if(wallet.data&&!wallet.error)amount=centsToEtb(etbToCents(wallet.data.available))}catch{/* Unavailable amounts are never displayed as zero. */}
 useEffect(()=>{const refresh=()=>wallet.reload();window.addEventListener('lowin-wallet-updated',refresh);return()=>window.removeEventListener('lowin-wallet-updated',refresh)},[wallet.reload]);
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
 return <header className={styles.header} role="banner" aria-label="Mini App header">
  <Link href="/" className={styles.brand} aria-label={am?'Lowwin መነሻ':'Lowwin Home'}><img src="/logo.png" width={28} height={28} alt=""/><span className={styles.brandName}>Lowwin</span></Link>
  <div className={styles.balancePill}>
   <Link href="/wallet" prefetch={false} className={styles.balance} aria-label={`${am?'ዋሌት':'Wallet'}${amount!==null?`, ${amount} ETB`:''}`} aria-busy={wallet.fetching||undefined} title={amount!==null?`${amount} ETB`:am?'ቀሪ ሂሳቡን ለማየት ዋሌትን ይክፈቱ':'Open Wallet to check your balance'}><Wallet size={14} strokeWidth={1.75} aria-hidden="true"/><span data-header-balance><span className={styles.balanceAmount}>{amount??'—'}</span>{' '}<small>ETB</small></span></Link>
   <WalletTopUpTrigger className={styles.addFunds} ariaLabel={am?'ገንዘብ ያስገቡ':'Deposit'}><Plus size={15} strokeWidth={1.75} aria-hidden="true"/></WalletTopUpTrigger>
  </div>
  <nav className={styles.actions} aria-label={am?'የመለያ ቁጥጥሮች':'Account controls'}>
  <AuctionQuickList className={styles.icon}/>
  <AlertBell className={styles.icon}/>
  <div className={styles.language} ref={languageRef}>
   <button ref={languageButtonRef} type="button" className={styles.languageButton} aria-label={`${t('language')}: ${language==='en'?'English':'አማርኛ'}`} aria-haspopup="menu" aria-controls={languageMenuId} aria-expanded={languageOpen} onClick={()=>setLanguageOpen(open=>!open)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setLanguageOpen(true)}}}><Languages size={16} strokeWidth={1.75} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'EN':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={languageOpen} size={10} strokeWidth={1.75} aria-hidden="true"/></button>
   {languageOpen&&<div ref={languageMenuRef} id={languageMenuId} className={styles.languageMenu} role="menu" aria-label={t('language')} onKeyDown={moveLanguageFocus}>{([['en','English'],['am','አማርኛ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} lang={value} onClick={()=>{setLanguage(value as MiniLanguage);setLanguageOpen(false);languageButtonRef.current?.focus()}}><span>{label}</span>{language===value&&<Check size={15} strokeWidth={1.75} aria-hidden="true"/>}</button>)}</div>}
  </div>
  <Link href="/profile" prefetch={false} className={styles.profile} aria-label={`${am?'መገለጫ':'Profile'}${name?`, ${name}`:''}`} title={name||undefined}><span className={styles.avatar}>{photo?<img src={photo} alt="" width={28} height={28} referrerPolicy="no-referrer" onError={()=>setFailedPhoto(photo)}/>:initials?<span>{initials}</span>:<UserRound size={17} strokeWidth={1.75} aria-hidden="true"/>}</span><span className={styles.profileName}>{name||(am?'መገለጫ':'Profile')}</span></Link>
  </nav>
 </header>;
}
