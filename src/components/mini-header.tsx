'use client';
import Link from 'next/link';
import {ChevronDown,Gavel,Globe2,Plus,UserRound} from 'lucide-react';
import {Button} from './ui/button';
import {AlertBell} from './alert-bell';
import {useTelegram} from './telegram-provider';
import {formatEtb} from '@/lib/money';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';

export function MiniHeader(){
 const {me,status}=useTelegram();
 const {language,setLanguage,t}=useMiniLocale();
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
  <Button asChild className={styles.add}><Link href="/wallet#add-etb" aria-label={t('funding')}><span><Plus size={17} aria-hidden="true"/></span></Link></Button>
  <AlertBell className={styles.icon} indicatorClassName={styles.unread}/>
  <Button asChild variant="outline" className={styles.icon}><Link href="/auctions" aria-label={t('browseAuctions')}><Gavel size={21} aria-hidden="true"/></Link></Button>
  <label className={styles.language}><Globe2 size={16} aria-hidden="true"/><span aria-hidden="true">{language.toUpperCase()}</span><ChevronDown size={12} aria-hidden="true"/><select value={language} onChange={event=>setLanguage(event.target.value as MiniLanguage)} aria-label={t('language')}><option value="en">English (EN)</option><option value="am">አማርኛ (AM)</option></select></label>
 </header>;
}
