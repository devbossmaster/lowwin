'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {ArrowLeft,Check,ChevronRight,Copy,Gift,Mail,MapPin,Pencil,Plus,Share2,ShieldCheck,Ticket,UsersRound,Wallet} from 'lucide-react';
import {IntentPrefetchLink as Link} from '@/components/intent-prefetch-link';
import {invalidatePrivateQueries} from '@/components/private-query-cache';
import {usePrivateQuery,PrivateState} from '@/components/private-query';
import {MiniRouteSkeleton} from '@/components/mini-route-skeleton';
import {useTelegram} from '@/components/telegram-provider';
import {OfflineRetry} from '@/components/offline-retry';
import {WalletTopUpTrigger} from '@/components/wallet-top-up-trigger';
import {miniNavigationState} from '@/components/mini-navigation-state';
import {useMiniLocale} from '@/components/mini-locale';
import {MiniLanguageMenu} from '@/components/mini-language-menu';
import {centsToEtb,etbToCents} from '@/lib/money';
import type {getPlayerProfile} from '@/modules/profile/personal';
import type {WalletBalance} from '@/modules/wallet/balance';
import styles from '@/components/profile-page.module.css';

const AccountSheet=dynamic(()=>import('@/components/account-sheet').then(module=>module.AccountSheet),{loading:()=>null});
type ReferralOverview={
  configured:boolean;enabled:boolean;shareUrl:string|null;discountPercent:number|null;expiryDays:number|null;
  counts:{signedUp:number;qualified:number;earned:number;available:number};
  coupons:{id:string;percent:number;expiresAt:string;status:'AVAILABLE'|'USED'|'EXPIRED'}[];
};
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
  const {language}=useMiniLocale(),am=language==='am',text=(en:string,translated:string)=>am?translated:en;
  const {refreshMe,me,queryIdentity,signOut}=useTelegram();
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  const [sharing,setSharing]=useState(false),[copied,setCopied]=useState(false),[shareMessage,setShareMessage]=useState('');
  const [loggingOut,setLoggingOut]=useState(false),[logoutMessage,setLogoutMessage]=useState('');
  useEffect(()=>{setMessage('');setShareMessage('');setCopied(false);setLogoutMessage('')},[language]);
  const [failedPhoto,setFailedPhoto]=useState<string|null>(null),editTrigger=useRef<HTMLButtonElement>(null),linkInput=useRef<HTMLInputElement>(null);
  const photo=me?.user.image?.startsWith('https://')&&failedPhoto!==me.user.image?me.user.image:null;
  const referral=data?.referral,knownRewards=!!referral?.configured,available=knownRewards?referral.counts.available:null;
  const shareUrl=referral?.enabled?referral.shareUrl:null;
  const home=miniNavigationState.visit(queryIdentity,'/');
  const initials=(data?.displayName??me?.user.name??'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase(language)||'L';
  let balance:string|null=null;
  try{if(wallet.data)balance=centsToEtb(etbToCents(wallet.data.available))}catch{/* Keep an unavailable balance distinct from zero. */}
  async function copyLink(){
    if(!shareUrl)return;
    setShareMessage('');
    try{await navigator.clipboard.writeText(shareUrl);setCopied(true);setShareMessage(text('Link copied.','ሊንኩ ተቀድቷል።'))}
    catch{linkInput.current?.focus();linkInput.current?.select();setShareMessage(text('Press and hold the link to copy it.','ሊንኩን ለመቅዳት ተጭነው ይያዙት።'))}
  }
  async function shareLink(){
    if(!shareUrl)return;
    setSharing(true);setShareMessage('');
    const invitation=text('Join me on Lowwin.','በLowwin ላይ ይቀላቀሉኝ።');
    try{
      if(window.Telegram?.WebApp?.openTelegramLink)window.Telegram.WebApp.openTelegramLink('https://t.me/share/url?'+new URLSearchParams({url:shareUrl,text:invitation}));
      else if(navigator.share)await navigator.share({title:'Lowwin',text:invitation,url:shareUrl});
      else await copyLink();
    }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setShareMessage(text('Could not share your link. Try copying it instead.','ሊንኩን ማጋራት አልተቻለም። በመቅዳት ይሞክሩ።'))}
    finally{setSharing(false)}
  }
  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!data)return;
    const form=new FormData(event.currentTarget);setSaving(true);setMessage('');
    try{
      const fields={displayName:form.get('displayName'),bio:data.bio??'',...(data.contactDetailsEditable?{contactEmail:form.get('contactEmail'),city:form.get('city')}:{})};
      const response=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields),cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('save');
      setEditing(false);setMessage(text('Profile saved.','መገለጫዎ ተቀምጧል።'));
      if(queryIdentity)invalidatePrivateQueries(queryIdentity);await refreshMe();
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
    <header className={styles.heading}><Link href={home?.href??'/'} scroll={home&&home.scrollY>0?false:undefined} className={styles.back} aria-label={text('Back to Home','ወደ መነሻ ይመለሱ')}><ArrowLeft size={20} aria-hidden="true"/></Link><h1>{text('Profile','መገለጫ')}</h1><div className={styles.language}><MiniLanguageMenu/></div></header>
    <PrivateState query={query} variant="profile"/>
    {query.status==='authenticated'&&data&&<>
      <section className={styles.identity} aria-label={text('Your account','መለያዎ')}>
        <span className={styles.avatar} aria-hidden="true"><span>{initials}</span>{photo&&<img key={photo} src={photo} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={()=>setFailedPhoto(photo)}/>}</span>
        <div className={styles.identityBody}><h2>{data.displayName}</h2>{data.phoneDisplay&&<p>{data.phoneDisplay}</p>}{data.contactVerified&&<span className={styles.verified}><ShieldCheck size={12} aria-hidden="true"/>{text('Verified account','የተረጋገጠ መለያ')}</span>}</div>
      </section>
      <section id="wallet" className={styles.wallet} aria-label={text('Your wallet','ዋሌትዎ')}>
        <div className={styles.walletHead}><span><Wallet size={15} aria-hidden="true"/>{text('Wallet','ዋሌት')}</span><Link className={styles.walletArrow} href="/wallet" aria-label={text('Open Wallet','ዋሌት ይክፈቱ')}><ChevronRight size={18} aria-hidden="true"/></Link></div>
        <p className={styles.balance} aria-busy={!wallet.data&&!wallet.error}>{balance??'—'} <span>ETB</span></p>
        <WalletTopUpTrigger className={styles.topUp} ariaLabel={text('Top up wallet','ወደ ዋሌት ገንዘብ ያስገቡ')}><Plus size={19} aria-hidden="true"/>{text('Top up','ገንዘብ ያስገቡ')}</WalletTopUpTrigger>
        {wallet.error&&<p className={styles.walletError} role="status">{text(wallet.data?'Showing your saved balance.':'Balance unavailable.',wallet.data?'የተቀመጠው ቀሪ ሂሳብ ይታያል።':'ቀሪ ሂሳቡ አይገኝም።')} <button type="button" onClick={wallet.reload}>{text('Retry','እንደገና')}</button></p>}
      </section>
      <div className={styles.summary} aria-label={text('Your activity','የእርስዎ እንቅስቃሴ')}>
        <div><span><Gift size={13} aria-hidden="true"/>{text('Available discounts','ያሉ ቅናሾች')}</span><strong className={styles.goldNumber}>{available??'—'}</strong></div>
        <div><span><Ticket size={13} aria-hidden="true"/>{text('Total bids','ጠቅላላ ጨረታዎች')}</span><strong>{data.counts.bids}</strong></div>
      </div>
      <section className={styles.panel} aria-labelledby="refer-heading">
        <div className={styles.panelHeading}><h2 id="refer-heading"><UsersRound size={17} aria-hidden="true"/>{text('Refer & earn','ይጋብዙ እና ያግኙ')}</h2></div>
        <p className={styles.description}>{referral?.enabled&&referral.discountPercent!==null?text(`Share your link. When a friend registers with it and makes their first accepted bid, you earn one ${referral.discountPercent}% discount on a submission fee.`,`ሊንክዎን ያጋሩ። ጓደኛዎ በሊንኩ ተመዝግቦ የመጀመሪያ ጨረታው ሲቀበል፣ ለአንድ የማስገቢያ ክፍያ ${referral.discountPercent}% ቅናሽ ያገኛሉ።`):text('Referral invitations are unavailable right now. Your link and reward terms will appear here when referrals are enabled.','የመጋበዣ አገልግሎት በአሁኑ ጊዜ አይገኝም። ሲነቃ ሊንክዎ እና የሽልማት ውሎች እዚህ ይታያሉ።')}</p>
        {shareUrl&&<div className={styles.referralLink}><input ref={linkInput} readOnly value={shareUrl} aria-label={text('Your referral link','የመጋበዣ ሊንክዎ')}/><button type="button" onClick={()=>void copyLink()} aria-label={text('Copy referral link','የመጋበዣ ሊንክ ይቅዱ')}>{copied?<Check size={17} aria-hidden="true"/>:<Copy size={17} aria-hidden="true"/>}</button></div>}
        <button className={styles.shareButton} type="button" disabled={!shareUrl||sharing} onClick={()=>void shareLink()}><Share2 size={17} aria-hidden="true"/>{sharing?text('Opening…','በመክፈት ላይ…'):text('Share my link','ሊንኬን አጋራ')}</button>
        {shareMessage&&<p className={styles.inlineNotice} role="status">{shareMessage}</p>}
        <div className={styles.referralStats}>{[{en:'Signed up',am:'የተመዘገቡ',value:knownRewards?referral.counts.signedUp:null},{en:'First bids',am:'የመጀመሪያ ጨረታ',value:knownRewards?referral.counts.qualified:null},{en:'Rewards earned',am:'የተገኙ ሽልማቶች',value:knownRewards?referral.counts.earned:null}].map(item=><div key={item.en}><strong>{item.value??'—'}</strong><span>{text(item.en,item.am)}</span></div>)}</div>
      </section>
      <section className={styles.panel} aria-labelledby="discounts-heading">
        <div className={styles.panelHeading}><h2 id="discounts-heading"><Ticket size={17} aria-hidden="true"/>{text('My discounts','የእኔ ቅናሾች')}</h2><span className={styles.count}>{available===null?text('Unavailable','አይገኝም'):text(`${available} available`,`${available} ይገኛሉ`)}</span></div>
        <p className={styles.description}>{text('Apply an earned discount in the bid sheet. It reduces the submission fee, not your chosen number.','በጨረታ ማቅረቢያው ላይ ያገኙትን ቅናሽ ይጠቀሙ። ቅናሹ የማስገቢያ ክፍያውን ይቀንሳል፣ የመረጡትን ቁጥር አይደለም።')}</p>
        {referral?.enabled&&referral.expiryDays!==null&&<p className={styles.description}>{text(`New rewards expire after ${referral.expiryDays} days.`,`አዲስ ሽልማቶች ከ${referral.expiryDays} ቀናት በኋላ ያበቃሉ።`)}</p>}
        {referral?.coupons.some(coupon=>coupon.status==='AVAILABLE')?<ul className={styles.discounts}>{referral.coupons.filter(coupon=>coupon.status==='AVAILABLE').map(coupon=><li key={coupon.id}><span className={styles.discountIcon}><Ticket size={19} aria-hidden="true"/></span><div><strong>{text(`${coupon.percent}% off one submission fee`,`${coupon.percent}% ቅናሽ ለአንድ የማስገቢያ ክፍያ`)}</strong><small>{text('Expires','የሚያበቃው')} {new Date(coupon.expiresAt).toLocaleDateString(am?'am-ET':'en-ET',{month:'short',day:'numeric',year:'numeric',timeZone:'Africa/Addis_Ababa'})}</small></div></li>)}</ul>:<p className={styles.emptyRewards}>{!knownRewards?text('Your earned discounts will appear here.','ያገኟቸው ቅናሾች እዚህ ይታያሉ።'):referral.enabled?text('No available discounts. Invite a friend to earn your first one.','የሚገኝ ቅናሽ የለም። የመጀመሪያዎን ለማግኘት ጓደኛ ይጋብዙ።'):text('No available discounts.','የሚገኝ ቅናሽ የለም።')}</p>}
      </section>
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
