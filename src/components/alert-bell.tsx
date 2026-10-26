'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {Bell} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery} from './private-query';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {AccountSheet} from './account-sheet';
import styles from './header-panels.module.css';
// Keep lazy content inside its own boundary so it cannot replace the Home
// header and unwind the open sheet's browser-history entry while loading.
const NotificationsInbox=dynamic(()=>import('./notifications-inbox').then(module=>module.NotificationsInbox),{loading:()=> <p role="status"><MiniPhrase en="Loading notifications…" am="ማሳወቂያዎችን በመጫን ላይ…"/></p>});
export function AlertBell({className}:{className?:string}){
  const {queryIdentity}=useTelegram();return <PlayerAlerts key={queryIdentity??'guest'} className={className}/>;
}
function PlayerAlerts({className}:{className?:string}){
  const {language}=useMiniLocale(),am=language==='am',path=usePathname(),[open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const summary=usePrivateQuery<{unread:number}>('/api/alerts?summary=1',{pollMs:300000}),count=summary.data?.unread;
  useEffect(()=>{setOpen(false)},[path]);
  useEffect(()=>{const refresh=()=>summary.reload();window.addEventListener('lowin-alerts',refresh);return()=>window.removeEventListener('lowin-alerts',refresh)},[summary.reload]);
  return <div><button ref={trigger} type="button" className={`${styles.trigger} ${className??''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${am?'ማሳወቂያዎች':'Notifications'}${count!==undefined?`, ${count} ${am?'ያልተነበቡ':'unread'}`:''}`} onClick={()=>setOpen(true)}><Bell size={18} strokeWidth={1.75} aria-hidden="true"/>{!!count&&<span className={styles.badge} data-unread-indicator aria-hidden="true">{count>99?'99+':count}</span>}</button>{open&&<AccountSheet title={am?'ማሳወቂያዎች':'Notifications'} onClose={()=>setOpen(false)} returnFocusRef={trigger}><NotificationsInbox onNavigate={()=>setOpen(false)}/></AccountSheet>}</div>;
}
