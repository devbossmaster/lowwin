'use client';
import {MiniInlineSkeleton} from './mini-route-skeleton';
import {usePrivateQuery} from './private-query';
import {invalidatePrivateQueries} from './private-query-cache';

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ArrowRight,Bell,CheckCheck,X} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {useMiniLocale,MiniPhrase} from './mini-locale';
import {notificationCopy} from './notification-copy';
import styles from './header-panels.module.css';

type Alert={id:string;kind?:string;title:string;body:string;href:string;readAt:string|null;createdAt:string};
type Inbox={items:Alert[];unread:number};
export function AlertBell({className}:{className?:string}){
 const {me,status,queryIdentity}=useTelegram();
 const userId=status==='authenticated'?me?.user.id:undefined;
 return <PlayerAlerts key={queryIdentity??'guest'} userId={userId} className={className}/>;
}
function PlayerAlerts({userId,className}:{userId?:string;className?:string}){
 const {language}=useMiniLocale(),am=language==='am',path=usePathname(),id=useId();
 const {queryIdentity}=useTelegram();
 const [open,setOpen]=useState(false),[localError,setError]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState<string|null>(null);
 const summary=usePrivateQuery<{unread:number}>('/api/alerts?summary=1',{pollMs:300000});
 const preview=usePrivateQuery<Inbox>('/api/alerts?preview=1',{enabled:open&&!!userId});
 const data=preview.data,count=summary.data?.unread??data?.unread??null,error=localError||preview.error;
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{setOpen(false)},[path]);
 useEffect(()=>{
   const refresh=()=>{summary.reload();if(open)preview.reload()};
   window.addEventListener('lowin-alerts',refresh);
   return()=>window.removeEventListener('lowin-alerts',refresh);
 },[summary.reload,preview.reload,open]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[open]);
 const markRead=useCallback(async(alertId?:string)=>{
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/alerts',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',...(alertId?{id:alertId}:{})}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Could not mark as read.');
   if(queryIdentity)invalidatePrivateQueries(queryIdentity);
  }catch{setError(am?'እንደገና ይሞክሩ።':'Could not mark as read. Retry.')}finally{setBusy(false)}
 },[busy,am,queryIdentity]);
 return <div ref={root}>
  <button ref={trigger} type="button" className={`${styles.trigger} ${className??''}`} aria-label={`${am?'ማሳወቂያዎች':'Notifications'}${count!==null?`, ${count} ${am?'ያልተነበቡ':'unread'}`:''}`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><Bell size={21} aria-hidden="true"/>{count!==null&&<span className={styles.badge} data-unread-indicator aria-hidden="true">{count>99?'99+':count}</span>}</button>
  {open&&<section id={id} className={styles.popover} aria-label={am?'ማሳወቂያዎች':'Notifications'}>
   <header className={styles.heading}><h2><MiniPhrase en="Notifications" am="ማሳወቂያዎች"/></h2><div className={styles.headingActions}><span className={styles.unread}>{count??'—'} <MiniPhrase en="Unread" am="ያልተነበቡ"/></span><button type="button" className={styles.iconButton} disabled={busy||!count} onClick={()=>void markRead()} aria-label={am?'ሁሉንም ማሳወቂያዎች እንደተነበቡ ምልክት ያድርጉ':'Mark all notifications as read'}><CheckCheck size={20}/></button><button type="button" className={styles.iconButton} aria-label={am?'ማሳወቂያዎችን ዝጋ':'Close notifications'} onClick={()=>{setOpen(false);trigger.current?.focus()}}><X size={18}/></button></div></header>
   <div className={styles.scroll}>
    {error&&<div className={styles.message} role="alert">{error}<button className={styles.retry} onClick={()=>{setError('');preview.reload()}}><MiniPhrase en="Retry" am="እንደገና ይሞክሩ"/></button></div>}
    {!userId?<p className={styles.message}><MiniPhrase en="Sign in to see your notifications." am="ማሳወቂያዎችዎን ለማየት ይግቡ።"/></p>:!data&&!error?<div className={styles.message}><MiniInlineSkeleton/></div>:data?.items.length===0?<p className={styles.message}><MiniPhrase en="No notifications yet." am="እስካሁን ማሳወቂያዎች የሉም።"/></p>:null}
    {data?.items.map(item=><article key={item.id} className={styles.notification} data-unread={!item.readAt}><span className={styles.notificationIcon}><Bell size={16} aria-hidden="true"/></span><div><h3>{notificationCopy(item,language).title}</h3><p className={expanded===item.id?undefined:styles.preview}>{notificationCopy(item,language).body}</p><button type="button" className={styles.readMore} aria-expanded={expanded===item.id} onClick={()=>{setExpanded(value=>value===item.id?null:item.id);if(!item.readAt)void markRead(item.id)}}><MiniPhrase en={expanded===item.id?'Show less':'Read more'} am={expanded===item.id?'ያሳንሱ':'ተጨማሪ ያንብቡ'}/></button>{expanded===item.id&&<div><Link prefetch={false} href={item.href} onClick={()=>setOpen(false)}><MiniPhrase en="View details" am="ዝርዝር ይመልከቱ"/><ArrowRight size={14}/></Link></div>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(am?'am-ET':'en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></div></article>)}
   </div>
   <Link className={styles.viewAll} href="/profile/alerts" prefetch={false} onClick={()=>setOpen(false)}><MiniPhrase en="View all" am="ሁሉንም ይመልከቱ"/><ArrowRight size={16}/></Link>
  </section>}
 </div>;
}
