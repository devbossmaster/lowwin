'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {Bell} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery} from './private-query';
import {useMiniLocale} from './mini-locale';
import styles from './header-panels.module.css';
const AccountSheet=dynamic(()=>import('./account-sheet').then(module=>module.AccountSheet));
const NotificationsInbox=dynamic(()=>import('./notifications-inbox').then(module=>module.NotificationsInbox));
export function AlertBell({className}:{className?:string}){
  const {queryIdentity}=useTelegram();return <PlayerAlerts key={queryIdentity??'guest'} className={className}/>;
}
function PlayerAlerts({className}:{className?:string}){
  const {language}=useMiniLocale(),am=language==='am',path=usePathname(),[open,setOpen]=useState(false);
  const summary=usePrivateQuery<{unread:number}>('/api/alerts?summary=1',{pollMs:300000}),count=summary.data?.unread;
  useEffect(()=>{setOpen(false)},[path]);
  useEffect(()=>{const refresh=()=>summary.reload();window.addEventListener('lowin-alerts',refresh);return()=>window.removeEventListener('lowin-alerts',refresh)},[summary.reload]);
  return <div><button type="button" className={`${styles.trigger} ${className??''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${am?'ማሳወቂያዎች':'Notifications'}${count!==undefined?`, ${count} ${am?'ያልተነበቡ':'unread'}`:''}`} onClick={()=>setOpen(true)}><Bell size={21} aria-hidden="true"/>{!!count&&<span className={styles.badge} data-unread-indicator aria-hidden="true">{count>99?'99+':count}</span>}</button>{open&&<AccountSheet title={am?'ማሳወቂያዎች':'Notifications'} onClose={()=>setOpen(false)}><NotificationsInbox onNavigate={()=>setOpen(false)}/></AccountSheet>}</div>;
}
