'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {IntentPrefetchLink as Link} from '@/components/intent-prefetch-link';
import {invalidatePrivateQueries} from '@/components/private-query-cache';
import {ChevronRight,Wallet,Trophy,Heart,CircleHelp,Bell,MessageCircle,UserRound,Pencil,ShieldCheck,FileText,LockKeyhole} from 'lucide-react';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
import {useTelegram} from '@/components/telegram-provider';
import {TelegramLink} from '@/components/telegram-link';
import {OfflineRetry} from '@/components/offline-retry';
import type {getPlayerProfile} from '@/modules/profile/personal';
import {formatEtb,etbToCents} from '@/lib/money';
import {useMiniLocale} from '@/components/mini-locale';
import styles from '@/components/account-pages.module.css';
const AccountSheet=dynamic(()=>import('@/components/account-sheet').then(module=>module.AccountSheet));
export default function Profile(){const {queryIdentity}=useTelegram();return <PlayerProfile key={queryIdentity??'guest'}/>}
function PlayerProfile(){
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPlayerProfile>>>('/api/profile'),data=query.data;
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {refreshMe,me,queryIdentity}=useTelegram();
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const photo=me?.user.image?.startsWith('https://')?me.user.image:null;
  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);setSaving(true);setMessage('');
    try{const response=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:form.get('displayName'),bio:form.get('bio')}),cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('save');setEditing(false);setMessage(text('Profile saved.','መገለጫዎ ተቀምጧል።'));if(queryIdentity)invalidatePrivateQueries(queryIdentity);await refreshMe()}catch{setMessage(text('Could not save. Please retry.','ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።'))}finally{setSaving(false)}
  }
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page}><header className={styles.heading}><h1>{text('Profile','መገለጫ')}</h1></header><PrivateState query={query} variant="profile"/>{query.status==='authenticated'&&data&&<>
    <div className={styles.profileHero}><span className={styles.avatar}><UserRound size={26} aria-hidden="true"/>{photo&&<img key={photo} src={photo} alt="" width={58} height={58} referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/>}</span><div><h2>{data.displayName}</h2><span className={styles.verified}><ShieldCheck size={13} aria-hidden="true"/>{text('Verified Telegram account','የተረጋገጠ የቴሌግራም መለያ')}</span></div></div>
    <div className={styles.summary}><div><span>{text('Accepted bids','የተቀበሉ ጨረታዎች')}</span><strong>{data.counts.bids}</strong></div><div><span>{text('Wins','ድሎች')}</span><strong>{data.counts.wins}</strong></div><div><span>{text('Favorites','ተወዳጆች')}</span><strong>{data.counts.favorites}</strong></div></div>
    <section className={styles.panel}><div className={styles.panelHead}><h2>{text('Basic information','መሠረታዊ መረጃ')}</h2><button className={styles.editButton} type="button" onClick={()=>{setMessage('');setEditing(true)}}><Pencil size={13} aria-hidden="true"/>{text('Edit','አስተካክል')}</button></div><dl className={styles.basicInfo}><div><dt>{text('Display name','የማሳያ ስም')}</dt><dd>{data.displayName}</dd></div><div><dt>{text('Telegram name','የቴሌግራም ስም')}</dt><dd>{me?.user.name??'—'}</dd></div><div><dt>{text('About you','ስለ እርስዎ')}</dt><dd>{data.bio||'—'}</dd></div></dl></section>
    <Link className={styles.drawCard} href="/wallet"><Wallet size={22} aria-hidden="true"/><span className={styles.rowBody}><strong className={styles.rowTitle}>{text('Existing wallet balance','ነባር የቦርሳ ቀሪ')}</strong><span className={styles.rowMeta}>{formatEtb(data.wallet.available)}{etbToCents(data.wallet.held)>0n?` · ${formatEtb(data.wallet.held)} ${text('held','የተያዘ')}`:''}</span></span><ChevronRight size={17} aria-hidden="true"/></Link>
  </>}
    {message&&<p className={styles.notice} role="status">{message}</p>}
    <div className={styles.profileLinks} style={{marginTop:18}}>{[{href:'/winning-bids',en:'My wins',am:'ያሸነፍኳቸው',icon:Trophy},{href:'/wallet?tab=transactions&type=payments',en:'Wallet & payment history',am:'የቦርሳ እና የክፍያ ታሪክ',icon:Wallet},{href:'/profile/favorites',en:'Favorites',am:'ተወዳጆች',icon:Heart},{href:'/profile/alerts',en:'Notifications',am:'ማሳወቂያዎች',icon:Bell},{href:'/faq',en:'How it works & FAQ',am:'አሠራሩ እና ጥያቄዎች',icon:CircleHelp}].map(({href,en,am:translated,icon:Icon})=><Link key={href} href={href}><Icon size={18} aria-hidden="true"/><span>{text(en,translated)}</span><ChevronRight size={16} aria-hidden="true"/></Link>)}<TelegramLink><MessageCircle size={18} aria-hidden="true"/><span>{text('Contact support','ድጋፍ ያግኙ')}</span><ChevronRight size={16} aria-hidden="true"/></TelegramLink><Link href="/terms"><FileText size={18} aria-hidden="true"/><span>{text('Terms of service','የአገልግሎት ውሎች')}</span><ChevronRight size={16} aria-hidden="true"/></Link><Link href="/privacy"><LockKeyhole size={18} aria-hidden="true"/><span>{text('Privacy policy','የግላዊነት ፖሊሲ')}</span><ChevronRight size={16} aria-hidden="true"/></Link></div>
  </section>{editing&&data&&<AccountSheet title={text('Edit profile','መገለጫ አስተካክል')} onClose={()=>{if(!saving)setEditing(false)}}><form className={styles.editor} onSubmit={save}><label>{text('Display name','የማሳያ ስም')}<input name="displayName" defaultValue={data.displayName} required maxLength={60} autoComplete="nickname"/></label><label>{text('About you','ስለ እርስዎ')}<textarea name="bio" defaultValue={data.bio} maxLength={160} rows={3}/></label><p className={styles.caption}>{text('These details are private. Your verified Telegram identity and contact details stay protected.','ይህ መረጃ የግልዎ ነው። የተረጋገጠ የቴሌግራም ማንነትዎ እና የእውቂያ መረጃዎ የተጠበቁ ናቸው።')}</p>{message&&<p className={styles.notice} role="status">{message}</p>}<button className={styles.action} disabled={saving}>{saving?text('Saving…','በማስቀመጥ ላይ…'):text('Save profile','መገለጫ አስቀምጥ')}</button></form></AccountSheet>}</>;
}
