'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Bell,CheckCheck,Clock3,CreditCard,Gift,Ticket,Trophy,Wallet} from 'lucide-react';
import {usePrivateQuery,PrivateState,PersonalPagination} from './private-query';
import {useTelegram} from './telegram-provider';
import {useMiniLocale} from './mini-locale';
import {notificationCopy,notificationAge} from './notification-copy';
import {invalidatePrivateQueries} from './private-query-cache';
import styles from './notifications-inbox.module.css';

type Category='all'|'draws'|'payments'|'promotions';
type Data={items:{id:string;kind?:string;title:string;body:string;href:string;readAt:string|null;createdAt:string}[];total:number;totalPages:number;unread:number;categories?:Category[]};
function notificationIcon(kind?:string){
  if(kind==='DEPOSIT_CREDITED'||kind==='PAYMENT_CREDITED')return Wallet;
  if(kind==='BID_ACCEPTED')return Ticket;
  if(kind==='AUCTION_WON'||kind==='AUCTION_RESULT'||kind==='AUCTION_FALLBACK_WON')return Trophy;
  if(kind?.includes('ENDING')||kind==='AUCTION_STARTING_SOON'||kind==='AUCTION_UPCOMING')return Clock3;
  return Bell;
}
export function NotificationsInbox({onNavigate}:{onNavigate?:()=>void}){
  const {queryIdentity}=useTelegram();
  return <PlayerInbox key={queryIdentity??'guest'} onNavigate={onNavigate}/>;
}
function PlayerInbox({onNavigate}:{onNavigate?:()=>void}){
  const {queryIdentity}=useTelegram(),{language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const [category,setCategory]=useState<Category>('all'),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const query=usePrivateQuery<Data>(`/api/alerts?category=${category}&page=${page}`),data=query.data;
  const filters:[Category,string,string,typeof Bell][]=[['all','All','ሁሉም',Bell],['draws','Winners','አሸናፊዎች',Trophy],['payments','Payments','ክፍያዎች',CreditCard],...(data?.categories?.includes('promotions')?[['promotions','Promotions','ማስታወቂያዎች',Gift] as [Category,string,string,typeof Bell]]:[])];
  async function markRead(id?:string){
    if(busy)return;setBusy(true);setError('');
    try{const response=await fetch('/api/alerts',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',...(id?{id}:{})}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('save');if(queryIdentity)invalidatePrivateQueries(queryIdentity,['/api/alerts'])}catch{setError(text('Could not update notifications. Please retry.','ማሳወቂያዎችን ማዘመን አልተቻለም። እንደገና ይሞክሩ።'))}finally{setBusy(false)}
  }
  return <div className={styles.inbox} data-notifications-inbox><div className={styles.filters} role="group" aria-label={text('Notification category','የማሳወቂያ ምድብ')}>{filters.map(([value,en,translated,Icon])=><button key={value} type="button" data-notification-filter={value} aria-pressed={category===value} onClick={()=>{setCategory(value);setPage(1)}}><Icon size={14} aria-hidden="true"/>{text(en,translated)}</button>)}</div><PrivateState query={query} variant="alerts"/>
    {data&&<div className={styles.tools}><span>{data.unread} {text('unread','ያልተነበቡ')}</span><button type="button" data-notifications-mark-all disabled={busy||!data.unread} onClick={()=>void markRead()}><CheckCheck size={15} aria-hidden="true"/>{text('Mark all read','ሁሉም ተነብበዋል')}</button></div>}
    {error&&<p className={styles.error} role="alert">{error}<button type="button" onClick={()=>setError('')}>{text('Dismiss','ዝጋ')}</button></p>}
    {data&&!data.items.length&&<div className={styles.empty}><Bell size={24} aria-hidden="true"/><h3>{text('You’re all caught up','አዲስ ማሳወቂያ የለም')}</h3><p>{category==='payments'?text('Payment updates will appear here.','የክፍያ መረጃዎች እዚህ ይታያሉ።'):category==='draws'?text('Auction and draw updates will appear here.','የጨረታ እና የውጤት መረጃዎች እዚህ ይታያሉ።'):text('Your LowWin updates will appear here.','የLowWin መረጃዎች እዚህ ይታያሉ።')}</p></div>}
    <div className={styles.list} role="list" aria-label={text('Your notifications','የእርስዎ ማሳወቂያዎች')}>{data?.items.map(item=>{const copy=notificationCopy(item,language),Icon=notificationIcon(item.kind);return <article className={styles.notification} role="listitem" data-notification-row data-unread={!item.readAt} key={item.id}><span className={styles.icon}><Icon size={17} strokeWidth={1.8} aria-hidden="true"/></span><div className={styles.content}><div className={styles.heading}><h3><Link href={item.href} prefetch={false} onClick={()=>{if(!item.readAt)void markRead(item.id);onNavigate?.()}}>{copy.title}</Link></h3>{!item.readAt&&<span className={styles.unread} role="img" aria-label={text('Unread','ያልተነበበ')}/>}</div><p>{copy.body}</p><div className={styles.meta}><time dateTime={item.createdAt}>{notificationAge(item.createdAt,language)}</time>{!item.readAt&&<button type="button" data-notification-mark-read disabled={busy} onClick={()=>void markRead(item.id)}>{text('Mark read','ተነብቧል')}</button>}</div></div></article>})}</div>
    {data&&<PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/>}
  </div>;
}
