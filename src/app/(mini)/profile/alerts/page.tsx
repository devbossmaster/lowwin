'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Bell,Check,CheckCheck,Clock3} from 'lucide-react';
import {usePrivateQuery,PrivateState,PersonalPagination} from '@/components/private-query';
import {useMiniLocale} from '@/components/mini-locale';
import {notificationCopy,notificationAge} from '@/components/notification-copy';
import styles from '@/components/personal-pages.module.css';

type Data={items:{id:string;kind?:string;title:string;body:string;href:string;readAt:string|null;createdAt:string}[];page:number;total:number;totalPages:number;unread:number};
export default function Alerts(){
  const {language}=useMiniLocale(),am=language==='am',locale=am?'am-ET':'en';
  const text=(en:string,amharic:string)=>am?amharic:en;
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const query=usePrivateQuery<Data>(`/api/alerts?page=${page}&v=${revision}`),data=query.data;
  async function update(body:unknown){
    setBusy(true);setError(false);
    try{
      const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('Could not save alerts. Retry.');
      setRevision(value=>value+1);
      window.dispatchEvent(new Event('lowin-alerts'));
    }catch{setError(true)}finally{setBusy(false)}
  }
  return <section className={styles.page}>
    <div className={styles.notifications}>
      <header className={styles.hero}>
        <div className={styles.heroTitle}><Bell size={25} aria-hidden="true"/><div><h1>{text('Notifications','ማሳወቂያዎች')}</h1><p>{text('Stay updated with your latest activities.','ስለ ቅርብ ጊዜ እንቅስቃሴዎችዎ ወቅታዊ መረጃ ያግኙ።')}</p></div></div>
        <button type="button" className={styles.markAll} aria-label={text('Mark all notifications as read','ሁሉንም ማሳወቂያዎች እንደተነበቡ ምልክት ያድርጉ')} title={text('Mark all as read','ሁሉንም እንደተነበቡ ምልክት ያድርጉ')} disabled={busy||!data?.unread} onClick={()=>void update({action:'read'})}><CheckCheck size={22}/></button>
        <div className={styles.stats} aria-label={text('Notification counts','የማሳወቂያዎች ብዛት')}>
          <span><strong>{data?.total??'—'}</strong><small>{text('Total','ጠቅላላ')}</small></span>
          <span><strong>{data?.unread??'—'}</strong><small>{text('Unread','ያልተነበቡ')}</small></span>
          <span><strong>{data?data.total-data.unread:'—'}</strong><small>{text('Read','የተነበቡ')}</small></span>
        </div>
      </header>

      <PrivateState query={query}/>
      {error&&<p role="alert" className="notice-card">{text('Could not save alerts. Retry.','ለውጦቹን ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።')}</p>}
      {data&&!data.items.length&&<p className={styles.empty}>{text('No notifications yet.','እስካሁን ማሳወቂያዎች የሉም።')}</p>}
      {data?.items.map(item=><article key={item.id} className={styles.alert}>
        <span className={styles.alertIcon}><Bell size={19} aria-hidden="true"/></span>
        <div className={styles.alertContent}>
          <header><h2><Link href={item.href} prefetch={false} onClick={()=>{if(!item.readAt)void update({action:'read',id:item.id})}}>{notificationCopy(item,language).title}</Link></h2><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString(locale)}><Clock3 size={11} aria-hidden="true"/>{notificationAge(item.createdAt,language)}</time></header>
          <p>{notificationCopy(item,language).body}</p>
          {item.readAt?<span className={styles.read}><Check size={12} aria-hidden="true"/>{text('Read','ተነብቧል')}</span>:<button type="button" className={styles.markRead} disabled={busy} onClick={()=>void update({action:'read',id:item.id})}><Check size={12} aria-hidden="true"/>{text('Mark read','እንደተነበበ ምልክት ያድርጉ')}</button>}
        </div>
      </article>)}
    </div>
    {data&&<PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/>}
  </section>;
}
