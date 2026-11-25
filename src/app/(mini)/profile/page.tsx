'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {Bell,ChevronRight,Gavel,Gift,Heart,Mail,MapPin,Pencil,Plus,ReceiptText,ShieldCheck,Ticket,Trophy,Wallet} from 'lucide-react';
import {IntentPrefetchLink as Link} from '@/components/intent-prefetch-link';
import {invalidatePrivateQueries} from '@/components/private-query-cache';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
import {useTelegram} from '@/components/telegram-provider';
import {OfflineRetry} from '@/components/offline-retry';
import {WalletTopUpTrigger} from '@/components/wallet-top-up-trigger';
import {WalletOverviewTrigger} from '@/components/wallet-overview-trigger';
import {useMiniLocale} from '@/components/mini-locale';
import {ReferralShareCard,type ReferralOverview} from '@/components/referral-share-card';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import type {getPlayerProfile} from '@/modules/profile/personal';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from '@/components/profile-page.module.css';

const AccountSheet=dynamic(()=>import('@/components/account-sheet').then(module=>module.AccountSheet),{loading:()=>null});
type ProfileData=Awaited<ReturnType<typeof getPlayerProfile>>&{
  contactEmail?:string;city?:string;contactDetailsEditable?:boolean;phoneDisplay?:string|null;contactVerified?:boolean;referral?:ReferralOverview;
};

export default function Profile(){
  const {queryIdentity}=useTelegram();
  return <PlayerProfile key={queryIdentity??'guest'}/>;
}
function PlayerProfile(){
  const query=usePrivateQuery<ProfileData>('/api/profile'),data=query.data;
  const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{freshnessMs:15000});
  const alerts=usePrivateQuery<{unread:number}>('/api/alerts?summary=1',{pollMs:300000});
  useEffect(()=>{const refresh=()=>alerts.reload();window.addEventListener('lowin-alerts',refresh);return()=>window.removeEventListener('lowin-alerts',refresh)},[alerts.reload]);
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {refreshMe,me,queryIdentity,signOut}=useTelegram();
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const [loggingOut,setLoggingOut]=useState(false),[logoutMessage,setLogoutMessage]=useState('');
  useEffect(()=>{setMessage('');setLogoutMessage('')},[language]);
  const [failedPhoto,setFailedPhoto]=useState<string|null>(null),editTrigger=useRef<HTMLButtonElement>(null);
  const photo=me?.user.image?.startsWith('https://')&&failedPhoto!==me.user.image?me.user.image:null;
  const referral=data?.referral;
  const referralEarnings=referral?.configured&&typeof referral.totalEarnedEtb==='string'?formatEtb(referral.totalEarnedEtb):'—';
  const initials=(data?.displayName??me?.user.name??'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase(language)||'L';
  let balance:string|null=null;
  try{if(wallet.data)balance=centsToEtb(etbToCents(wallet.data.available))}catch{/* Keep an unavailable balance distinct from zero. */}
  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!data)return;
    const form=new FormData(event.currentTarget);setSaving(true);setMessage('');
    try{
      const fields={displayName:form.get('displayName'),bio:data.bio??'',...(data.contactDetailsEditable?{contactEmail:form.get('contactEmail'),city:form.get('city')}:{})};
      const response=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields),cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('save');
      setEditing(false);setMessage(text('Profile saved.','መገለጫዎ ተቀምጧል።'));
      if(queryIdentity)invalidatePrivateQueries(queryIdentity,['/api/profile']);await refreshMe();
    }catch{setMessage(text('Could not save. Please retry.','ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።'))}
    finally{setSaving(false)}
  }
  async function logout(){
    if(loggingOut)return;
    setLoggingOut(true);setLogoutMessage('');
    try{await signOut()}
    catch{setLogoutMessage(text('Could not log out. Please retry.','መውጣት አልተቻለም። እንደገና ይሞክሩ።'))}
    finally{setLoggingOut(false)}
  }
  if(query.status==='loading'||query.status==='authenticated'&&!data&&!query.error)return <MiniRouteSkeleton/>;
  return <><OfflineRetry/><section className={styles.page} data-profile-ready={!!data||undefined}>
    <PrivateState query={query} variant="profile"/>
    {query.status==='authenticated'&&data&&<>
      <section className={styles.identity} aria-label={text('Your account','መለያዎ')}>
        <span className={styles.avatar} aria-hidden="true"><span>{initials}</span>{photo&&<img key={photo} src={photo} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={()=>setFailedPhoto(photo)}/>}</span>
        <div className={styles.identityBody}><h2>{data.displayName}</h2>{data.phoneDisplay&&<p>{data.phoneDisplay}</p>}{data.contactVerified&&<span className={styles.verified}><ShieldCheck size={12} aria-hidden="true"/>{text('Verified account','የተረጋገጠ መለያ')}</span>}</div>
      </section>
      <section id="wallet" className={styles.wallet} aria-label={text('Your wallet','ዋሌትዎ')}>
        <div className={styles.walletHead}><span><Wallet size={15} aria-hidden="true"/>{text('Wallet','ዋሌት')}</span><WalletOverviewTrigger className={styles.walletArrow} ariaLabel={text('Open Wallet','ዋሌት ይክፈቱ')}><ChevronRight size={18} aria-hidden="true"/></WalletOverviewTrigger></div>
        <p className={styles.balance} aria-busy={!wallet.data&&!wallet.error}>{balance??'—'} <span>ETB</span></p>
        {wallet.data?.bonusAvailable&&etbToCents(wallet.data.bonusAvailable)>0n&&<div className={styles.walletSplit}><span>{text('Wallet funds','የዋሌት ገንዘብ')} <b>{centsToEtb(etbToCents(wallet.data.cashAvailable))} ETB</b></span><span>{text('Active bonus','ያለ ቦነስ')} <b>{centsToEtb(etbToCents(wallet.data.bonusAvailable))} ETB</b></span></div>}
        <WalletTopUpTrigger className={styles.topUp} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={19} aria-hidden="true"/>{text('Top up','ገንዘብ ያስገቡ')}</WalletTopUpTrigger>
        <Link href="/payments" className={styles.walletTransactions}><ReceiptText size={17} aria-hidden="true"/><span>{text('Transactions','\u130d\u1265\u12ed\u1276\u127d')}</span><ChevronRight size={16} aria-hidden="true"/></Link>
        {wallet.error&&<p className={styles.walletError} role="status">{text(wallet.data?'Showing your saved balance.':'Balance unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
      </section>
      <div className={styles.summary} aria-label={text('Your activity','የእርስዎ እንቅስቃሴ')}>
        <div><span><Gift size={13} aria-hidden="true"/>{text('Referral earnings','የግብዣ ገቢ')}</span><strong className={styles.referralAmount}>{referralEarnings}</strong></div>
        <div><span><Ticket size={13} aria-hidden="true"/>{text('Total bids','ጠቅላላ ጨረታዎች')}</span><strong>{data.counts.bids}</strong></div>
      </div>
      <Link href="/profile/alerts" className={styles.notifications}><Bell size={19} aria-hidden="true"/><span>{text('Notifications','ማሳወቂያዎች')}</span>{alerts.data&&alerts.data.unread>0&&<strong data-unread-indicator aria-label={text(`${alerts.data.unread} unread`,`${alerts.data.unread} ያልተነበቡ`)}>{alerts.data.unread>99?'99+':alerts.data.unread}</strong>}<ChevronRight size={18} aria-hidden="true"/></Link>
      <nav className={styles.shortcuts} aria-label={text('Your auctions','የእርስዎ ጨረታዎች')}>
        <Link href="/my-bids"><span className={styles.shortcutIcon}><Gavel size={20} aria-hidden="true"/></span><span><strong>{text('My bids','ጨረታዎቼ')}</strong><small>{text('Your live and finished entries','የቀጥታ እና ያለቁ ጨረታዎችዎ')}</small></span><ChevronRight size={17} aria-hidden="true"/></Link>
        <Link href="/winning-bids"><span className={styles.shortcutIcon}><Trophy size={20} aria-hidden="true"/></span><span><strong>{text('My wins','ያሸነፍኳቸው')}</strong><small>{text('Prizes and delivery updates','ሽልማቶች እና የርክክብ ዝማኔዎች')}</small></span><ChevronRight size={17} aria-hidden="true"/></Link>
        <Link href="/profile/favorites"><span className={styles.shortcutIcon}><Heart size={20} aria-hidden="true"/></span><span><strong>{text('Saved prizes','የተቀመጡ ሽልማቶች')}</strong><small>{text('Auctions you saved','ያስቀመጧቸው ጨረታዎች')}</small></span><ChevronRight size={17} aria-hidden="true"/></Link>
      </nav>
      <ReferralShareCard overview={referral}/>
      <section className={styles.panel} aria-labelledby="basic-heading">
        <div className={styles.panelHeading}><h2 id="basic-heading">{text('Basic info','መሠረታዊ መረጃ')}</h2><button ref={editTrigger} className={styles.editButton} type="button" onClick={()=>{setMessage('');setEditing(true)}}><Pencil size={13} aria-hidden="true"/>{text('Edit','አስተካክል')}</button></div>
        <dl className={styles.basicInfo}><div><dt>{text('Nickname','የማሳያ ስም')}</dt><dd>{data.displayName}</dd></div><div><dt>{text('Phone number','ስልክ ቁጥር')}</dt><dd>{data.phoneDisplay??'—'}</dd></div><div><dt>{text('Contact email','የእውቂያ ኢሜይል')}</dt><dd>{data.contactEmail||'—'}</dd></div><div><dt>{text('City','ከተማ')}</dt><dd>{data.city||'—'}</dd></div></dl>
      </section>
      <button className={styles.logout} type="button" disabled={loggingOut} onClick={()=>void logout()}>{loggingOut?text('Logging out…','በመውጣት ላይ…'):text('Log out','ውጣ')}</button>
      {logoutMessage&&<p className={styles.notice} role="alert">{logoutMessage}</p>}
    </>}
    {message&&<p className={styles.notice} role="status">{message}</p>}
  </section>{editing&&data&&<AccountSheet title={text('Edit profile','መገለጫ አስተካክል')} onClose={()=>{if(!saving)setEditing(false)}} returnFocusRef={editTrigger}><form className={styles.editor} onSubmit={save}><label>{text('Nickname','የማሳያ ስም')}<input name="displayName" defaultValue={data.displayName} required maxLength={60} autoComplete="nickname"/></label><label>{text('Contact email','የእውቂያ ኢሜይል')}<span className={styles.inputIcon}><Mail size={16} aria-hidden="true"/><input name="contactEmail" type="email" defaultValue={data.contactEmail??''} disabled={!data.contactDetailsEditable} maxLength={254} autoComplete="email"/></span></label><label>{text('City','ከተማ')}<span className={styles.inputIcon}><MapPin size={16} aria-hidden="true"/><input name="city" defaultValue={data.city??''} disabled={!data.contactDetailsEditable} maxLength={80} autoComplete="address-level2"/></span></label>{!data.contactDetailsEditable&&<p className={styles.description}>{text('Email and city editing is not available yet. You can still update your nickname.','ኢሜይል እና ከተማ ማስተካከል ገና አልተጀመረም። የማሳያ ስምዎን ማስተካከል ይችላሉ።')}</p>}<p className={styles.description}>{text('Your verified phone number is managed through Telegram contact verification.','የተረጋገጠው ስልክ ቁጥርዎ በቴሌግራም እውቂያ ማረጋገጫ ይተዳደራል።')}</p>{message&&<p className={styles.notice} role="status">{message}</p>}<button className={styles.shareButton} disabled={saving}>{saving?text('Saving…','በማስቀመጥ ላይ…'):text('Save profile','መገለጫ አስቀምጥ')}</button></form></AccountSheet>}</>;
}
