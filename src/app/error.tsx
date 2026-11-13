'use client';
import {useEffect,useState} from 'react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {RotateCcw,ShieldAlert,WifiOff} from 'lucide-react';
import {useMiniLocale} from '@/components/mini-locale';
import styles from './error.module.css';

export default function ErrorPage({retry,reset}:{retry?:()=>void;reset:()=>void}){
 const {language}=useMiniLocale(),am=language==='am';
 const [offline,setOffline]=useState(false),[imageFailed,setImageFailed]=useState(false);
 useEffect(()=>{const sync=()=>setOffline(navigator.onLine===false);sync();window.addEventListener('online',sync);window.addEventListener('offline',sync);return()=>{window.removeEventListener('online',sync);window.removeEventListener('offline',sync)}},[]);
 return <main id="main" className={styles.root} lang={language}><section className={styles.card} aria-labelledby="page-error-title">
  <div className={styles.brand}>{imageFailed?<ShieldAlert size={28} aria-hidden="true"/>:<img src={LOWWIN_LOGO_SRC} alt="" width={40} height={40} onError={()=>setImageFailed(true)}/>}<strong>LowWin</strong></div>
  {offline&&<WifiOff className={styles.offlineIcon} size={24} aria-hidden="true"/>}
  <h1 id="page-error-title">{offline?(am?'ግንኙነትዎ ተቋርጧል':'You’re offline'):(am?'ገጹን መጫን አልተቻለም':'This page couldn’t load')}</h1>
  <p>{offline?(am?'ከበይነመረብ ጋር ይገናኙና እንደገና ይሞክሩ።':'Reconnect to the internet, then try again.'):(am?'ገጹን ለማደስ እንደገና ይሞክሩ።':'Please try again to reload this page.')}</p>
  <button type="button" className={styles.retry} onClick={retry??reset}><RotateCcw size={18} aria-hidden="true"/>{am?'እንደገና ይሞክሩ':'Try again'}</button>
 </section></main>;
}
