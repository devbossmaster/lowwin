'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight,Wallet,Trophy,Heart,CircleHelp,Bell,Layers,MessageCircle } from 'lucide-react';
import { usePrivateQuery,PrivateState } from '@/components/private-query';
import { useTelegram } from '@/components/telegram-provider';
import { OfflineRetry } from '@/components/offline-retry';
import type { getPlayerProfile } from '@/modules/profile/personal';
import { formatEtb } from '@/lib/money';
export default function Profile() {
  const query=usePrivateQuery<Awaited<ReturnType<typeof getPlayerProfile>>>('/api/profile'),data=query.data;
  const {refreshMe}=useTelegram();const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);setSaving(true);setMessage('');
    try{const response=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:form.get('displayName'),bio:form.get('bio')}),cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);setEditing(false);setMessage('Display profile saved.');query.reload();await refreshMe()}catch(error){setMessage(error instanceof Error?error.message:'Could not save. Please retry.')}finally{setSaving(false)}
  }
  return <><OfflineRetry/><section className="page-inset"><h1 className="page-title">Your profile<span className="title-dot">.</span></h1><PrivateState query={query}/>{data&&<>
    <div className="profile-heading"><div><h2>{data.displayName}</h2><p>{data.bio||'Your ETB balance, bids and saved auctions.'}</p></div><button className="secondary-button" onClick={()=>{setEditing(!editing);setMessage('')}}>{editing?'Cancel':'Edit'}</button></div>
    {editing&&<form className="profile-editor" onSubmit={save}><label>Display name<input name="displayName" defaultValue={data.displayName} required maxLength={60} autoComplete="nickname"/></label><label>About you<textarea name="bio" defaultValue={data.bio} maxLength={160} rows={3}/></label><p>These fields are private to your profile. Verified Telegram identity and contact details cannot be edited here.</p><button className="primary-bid-button" disabled={saving}>{saving?'Saving…':'Save profile'}</button></form>}
    {message&&<p className="inline-empty" role="status">{message}</p>}
    <Link className="profile-wallet" href="/wallet"><span>Available ETB<strong>{formatEtb(data.wallet.available)}</strong></span><span>Held<strong>{formatEtb(data.wallet.held)}</strong></span><ChevronRight size={18}/></Link>
    <div className="profile-counts"><Link href="/my-bids"><strong>{data.counts.bids}</strong><span>Accepted bids</span></Link><Link href="/profile/wins"><strong>{data.counts.wins}</strong><span>Wins</span></Link><Link href="/profile/favorites"><strong>{data.counts.favorites}</strong><span>Favorites</span></Link></div>
    <p className="profile-caption">{data.counts.liveBids} live bids · {data.counts.historyBids} in history</p>
  </>}
    <div className="profile-links">{[{href:'/my-bids',label:'My bids',icon:Layers},{href:'/wallet',label:'ETB wallet',icon:Wallet},{href:'/profile/wins',label:'My wins',icon:Trophy},{href:'/profile/favorites',label:'Favorites',icon:Heart},{href:'/profile/alerts',label:'Alerts',icon:Bell},{href:'/profile/support',label:'Support',icon:MessageCircle},{href:'/faq',label:'How it works & help',icon:CircleHelp}].map(({href,label,icon:Icon})=><Link key={href} href={href}><Icon size={20}/><span>{label}</span><ChevronRight size={18}/></Link>)}</div><p className="profile-caption">Manage your saved auctions, private alerts and support requests here.</p>
  </section></>;
}
