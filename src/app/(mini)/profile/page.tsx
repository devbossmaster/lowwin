'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight,Wallet,Trophy,Heart,CircleHelp,Bell,Layers,MessageCircle,UserRound,Pencil } from 'lucide-react';
import { usePrivateQuery,PrivateState } from '@/components/private-query';
import { useTelegram } from '@/components/telegram-provider';
import {TelegramLink} from '@/components/telegram-link';
import { OfflineRetry } from '@/components/offline-retry';
import type { getPlayerProfile } from '@/modules/profile/personal';
import { formatEtb } from '@/lib/money';
import {useMiniLocale} from '@/components/mini-locale';
export default function Profile() {
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPlayerProfile>>>('/api/profile'),data=query.data;
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,amharic:string)=>am?amharic:en;
  const {refreshMe,me}=useTelegram();const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const photo=me?.user.image?.startsWith('https://')?me.user.image:null;
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);setSaving(true);setMessage('');
    try{const response=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:form.get('displayName'),bio:form.get('bio')}),cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);setEditing(false);setMessage(text('Display profile saved.','መገለጫዎ ተቀምጧል።'));query.reload();await refreshMe()}catch{setMessage(text('Could not save. Please retry.','መገለጫዎን ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።'))}finally{setSaving(false)}
  }
  return <><OfflineRetry/><section className="page-inset profile-page"><h1 className="profile-accessible-title">{text('Profile','መገለጫ')}</h1><PrivateState query={query}/>{data&&<>
    <div className="profile-heading"><span className="profile-avatar"><UserRound size={24} aria-hidden="true"/>{photo&&<img key={photo} src={photo} alt="" width={48} height={48} referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/>}</span><div><h2>{data.displayName}</h2>{data.bio&&<p>{data.bio}</p>}</div><button type="button" className="secondary-button" aria-expanded={editing} aria-controls="profile-editor" onClick={()=>{setEditing(!editing);setMessage('')}}><Pencil size={14} aria-hidden="true"/>{editing?text('Cancel','ይቅር'):text('Edit','አስተካክል')}</button></div>
    {editing&&<form id="profile-editor" className="profile-editor" onSubmit={save}><label>{text('Display name','የማሳያ ስም')}<input name="displayName" defaultValue={data.displayName} required maxLength={60} autoComplete="nickname"/></label><label>{text('About you','ስለ እርስዎ')}<textarea name="bio" defaultValue={data.bio} maxLength={160} rows={3}/></label><p>{text('These fields are private to your profile. Verified Telegram identity and contact details cannot be edited here.','እነዚህ መረጃዎች በመገለጫዎ ውስጥ ብቻ ይታያሉ። የተረጋገጠውን የቴሌግራም ማንነትና የእውቂያ መረጃ ከዚህ ማስተካከል አይቻልም።')}</p><button className="primary-bid-button" disabled={saving}>{saving?text('Saving…','በማስቀመጥ ላይ…'):text('Save profile','መገለጫውን አስቀምጥ')}</button></form>}
    {message&&<p className="inline-empty" role="status">{message}</p>}
    <Link className="profile-wallet" href="/wallet"><span className="profile-wallet-label"><Wallet size={18} aria-hidden="true"/>{text('Available balance','ለመጠቀም ያለ ቀሪ')}<ChevronRight size={18} aria-hidden="true"/></span><strong className="profile-wallet-amount">{formatEtb(data.wallet.available)}</strong><span className="profile-wallet-held"><span>{text('Held','የተያዘ')}</span><strong>{formatEtb(data.wallet.held)}</strong></span></Link>
    <div className="profile-counts"><Link href="/my-bids"><strong>{data.counts.bids}</strong><span>{text('Accepted bids','የተቀበሉ ጨረታዎች')}</span></Link><Link href="/winning-bids"><strong>{data.counts.wins}</strong><span>{text('Wins','ድሎች')}</span></Link><Link href="/profile/favorites"><strong>{data.counts.favorites}</strong><span>{text('Favorites','ተወዳጆች')}</span></Link></div>
    <p className="profile-caption">{am?`${data.counts.liveBids} ቀጥታ ጨረታዎች · ${data.counts.historyBids} በታሪክ ውስጥ`:`${data.counts.liveBids} live bids · ${data.counts.historyBids} in history`}</p>
  </>}
    <div className="profile-links">{[{href:'/my-bids',en:'My bids',am:'የእኔ ጨረታዎች',icon:Layers},{href:'/wallet',en:'ETB wallet',am:'የETB ቦርሳ',icon:Wallet},{href:'/winning-bids',en:'My wins',am:'ያሸነፍኳቸው',icon:Trophy},{href:'/profile/favorites',en:'Favorites',am:'ተወዳጆች',icon:Heart},{href:'/profile/alerts',en:'Alerts',am:'ማሳወቂያዎች',icon:Bell},{href:'/faq',en:'How it works & help',am:'አሠራሩ እና እገዛ',icon:CircleHelp}].map(({href,en,am:labelAm,icon:Icon})=><Link key={href} href={href}><Icon size={20}/><span>{text(en,labelAm)}</span><ChevronRight size={18}/></Link>)}<TelegramLink><MessageCircle size={20}/><span>{text('Support on Telegram','ድጋፍ በቴሌግራም')}</span><ChevronRight size={18}/></TelegramLink></div><p className="profile-caption">{text('Manage your saved auctions and private alerts here.','ያስቀመጧቸውን ጨረታዎች እና የግል ማሳወቂያዎችን እዚህ ያስተዳድሩ።')}</p>
  </section></>;
}
