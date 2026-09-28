'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Bell,Check,CheckCheck,Clock3,Settings2} from 'lucide-react';
import {usePrivateQuery,PrivateState,PersonalPagination} from '@/components/private-query';
import styles from '@/components/personal-pages.module.css';

type Preferences={inApp:boolean;telegram:boolean;auctionStart:boolean;favoriteEnding:boolean;fulfillment:boolean};
type Data={items:{id:string;title:string;body:string;href:string;readAt:string|null;createdAt:string}[];page:number;total:number;totalPages:number;unread:number;preferences:Preferences};
const relative=new Intl.RelativeTimeFormat('en',{numeric:'auto'});
function age(date:string){
  const seconds=Math.max(0,(Date.now()-new Date(date).getTime())/1000);
  if(seconds<60)return 'Just now';
  if(seconds<3600)return relative.format(-Math.floor(seconds/60),'minute');
  if(seconds<86400)return relative.format(-Math.floor(seconds/3600),'hour');
  if(seconds<604800)return relative.format(-Math.floor(seconds/86400),'day');
  if(seconds<2592000)return relative.format(-Math.floor(seconds/604800),'week');
  return new Date(date).toLocaleDateString('en',{month:'short',day:'numeric'});
}
export default function Alerts(){
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [pendingPreferences,setPendingPreferences]=useState<Partial<Preferences>>({});
  const query=usePrivateQuery<Data>(`/api/alerts?page=${page}&v=${revision}`),data=query.data;
  async function update(body:unknown){
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('Could not save alerts. Retry.');
      if((body as {action:string}).action!=='preferences')setRevision(value=>value+1);
      window.dispatchEvent(new Event('lowin-alerts'));
    }catch(cause){setPendingPreferences({});setError((cause as Error).message)}finally{setBusy(false)}
  }
  return <section className={styles.page}>
    <div className={styles.notifications}>
      <header className={styles.hero}>
        <div className={styles.heroTitle}><Bell size={25} aria-hidden="true"/><div><h1>Notifications</h1><p>Stay updated with your latest activities.</p></div></div>
        <button type="button" className={styles.markAll} aria-label="Mark all notifications as read" title="Mark all as read" disabled={busy||!data?.unread} onClick={()=>void update({action:'read'})}><CheckCheck size={22}/></button>
        <div className={styles.stats} aria-label="Notification counts">
          <span><strong>{data?.total??'—'}</strong><small>Total</small></span>
          <span><strong>{data?.unread??'—'}</strong><small>Unread</small></span>
          <span><strong>{data?data.total-data.unread:'—'}</strong><small>Read</small></span>
        </div>
      </header>
      <PrivateState query={query}/>
      {error&&<p role="alert" className="notice-card">{error}</p>}
      {data&&!data.items.length&&<p className={styles.empty}>No notifications yet.</p>}
      {data?.items.map(item=><article key={item.id} className={styles.alert}>
        <span className={styles.alertIcon}><Bell size={19} aria-hidden="true"/></span>
        <div className={styles.alertContent}>
          <header><h2><Link href={item.href} prefetch={false} onClick={()=>{if(!item.readAt)void update({action:'read',id:item.id})}}>{item.title}</Link></h2><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}><Clock3 size={11} aria-hidden="true"/>{age(item.createdAt)}</time></header>
          <p>{item.body}</p>
          {item.readAt?<span className={styles.read}><Check size={12} aria-hidden="true"/>Read</span>:<button type="button" className={styles.markRead} disabled={busy} onClick={()=>void update({action:'read',id:item.id})}><Check size={12} aria-hidden="true"/>Mark read</button>}
        </div>
      </article>)}
    </div>
    {data&&<><PersonalPagination page={page} totalPages={data.totalPages} setPage={setPage}/>
      <details className={styles.preferences}><summary><Settings2 size={16}/>Notification preferences</summary><p>Choose which updates you receive.</p>
        {([['inApp','In-app alerts'],['telegram','Private Telegram bot messages'],['auctionStart','Saved auction starts'],['favoriteEnding','Saved auctions ending soon'],['fulfillment','Delivery updates']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={pendingPreferences[key]??data.preferences[key]} disabled={busy} onChange={event=>{setPendingPreferences(previous=>({...previous,[key]:event.target.checked}));void update({action:'preferences',...data.preferences,...pendingPreferences,[key]:event.target.checked})}}/>{label}</label>)}
      </details>
    </>}
  </section>;
}