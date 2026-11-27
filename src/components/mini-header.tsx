'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useId,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Check,ChevronDown,Gift,Languages,LogIn,Plus,Wallet,X} from 'lucide-react';
import {AuctionQuickList} from './auction-quick-list';
import {AlertBell} from './alert-bell';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import {WalletOverviewTrigger} from './wallet-overview-trigger';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery} from './private-query';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import type {WalletBalance} from '@/modules/wallet/balance';
import {useMiniLocale,type MiniLanguage} from './mini-locale';
import styles from './mini-header.module.css';
import {LOWWIN_BRAND_NAME} from '@/lib/brand';
import {BrandMark} from './brand-mark';
import {MiniAccountAction} from './mini-account-action';
import {IntentPrefetchLink} from './intent-prefetch-link';

const affiliatePromoDismissedKey='lowwin-affiliate-promo-dismissed';
type ReferralPromoPolicy={configured:boolean;enabled:boolean;rewardEtb:string|null};

export function MiniHeader({showReferralPromo}:{showReferralPromo:boolean}){
 const {language,setLanguage,t}=useMiniLocale();
 const {status,me,queryIdentity,openRegistration,environment}=useTelegram(),am=language==='am',path=usePathname();
 // This account is set only after the server confirms registration. A contact
 // sharing callback must never make a guest eligible for private wallet reads.
 const registered=status==='authenticated'&&!!me&&!!queryIdentity;
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:registered&&path==='/',freshnessMs:15000,pollMs:60000});
 const [affiliatePromoDismissed,setAffiliatePromoDismissed]=useState<boolean|null>(null);
 const affiliatePromoId=useId();
 const affiliateLinkRef=useRef<HTMLAnchorElement>(null);
 useEffect(()=>{
  try{setAffiliatePromoDismissed(sessionStorage.getItem(affiliatePromoDismissedKey)==='1')}
  catch{setAffiliatePromoDismissed(false)}
 },[]);
 const referralPolicy=usePrivateQuery<ReferralPromoPolicy>('/api/referrals?view=policy',{
  enabled:registered&&path==='/'&&showReferralPromo&&affiliatePromoDismissed===false,
  freshnessMs:60000,
  cancelOnUnmount:true,
 });
 const promoPolicy=referralPolicy.error?null:referralPolicy.data;
 const promoReward=promoPolicy?.configured&&promoPolicy.enabled?promoPolicy.rewardEtb:null;
 const dismissAffiliatePromo=(restoreFocus:boolean)=>{
  setAffiliatePromoDismissed(true);
  try{sessionStorage.setItem(affiliatePromoDismissedKey,'1')}catch{/* This mount still remembers the dismissal. */}
  if(restoreFocus)affiliateLinkRef.current?.focus({preventScroll:true});
 };
 let amount:string|null=null;
 try{if(wallet.data)amount=centsToEtb(etbToCents(wallet.data.available))}catch{/* Unavailable amounts are never displayed as zero. */}
 const [languageOpen,setLanguageOpen]=useState(false);
 const languageRef=useRef<HTMLDivElement>(null);
 const languageButtonRef=useRef<HTMLButtonElement>(null);
 const languageMenuRef=useRef<HTMLDivElement>(null),languageMenuId=useId();
 useEffect(()=>{
  if(!languageOpen)return;
  languageMenuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  const closeOutside=(event:PointerEvent)=>{if(!languageRef.current?.contains(event.target as Node))setLanguageOpen(false)};
  const closeEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setLanguageOpen(false);languageButtonRef.current?.focus()}};
  document.addEventListener('pointerdown',closeOutside);
  document.addEventListener('keydown',closeEscape);
  return()=>{document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape)};
 },[languageOpen]);
 const moveLanguageFocus=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
  const options=Array.from(languageMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]);
  const index=options.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();
   const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
   options[next]?.focus();
  }else if(event.key==='Tab'){setLanguageOpen(false);languageButtonRef.current?.focus()}
 };
 if(path!=='/')return null;
 return <header className={styles.header} role="banner" aria-label="Mini App header" data-home-header data-has-affiliate={registered||undefined}>
  <Link href="/" className={styles.brand} aria-label={am?'LowWin መነሻ':'LowWin Home'}><BrandMark/><span className={styles.brandName}>{LOWWIN_BRAND_NAME}</span></Link>
  <div className={styles.accountControls} data-header-account-controls>
  {registered?<div className={styles.balancePill} data-long-balance={amount!==null&&amount.length>6||undefined}>
   <WalletOverviewTrigger ariaBusy={amount===null||undefined} className={styles.balance} ariaLabel={`${am?'ዋሌት':'Wallet'}${amount!==null?`, ${amount} ETB`:''}`} title={amount!==null?`${amount} ETB`:am?'ቀሪ ሂሳቡን ለማየት ዋሌትን ይክፈቱ':'Open Wallet to check your balance'}><Wallet size={14} strokeWidth={1.75} aria-hidden="true"/><span data-header-balance aria-busy={amount===null||undefined}><span className={styles.balanceAmount}>{amount??<span className={styles.balancePlaceholder} aria-label={am?'ሂሳብ በመጫን ላይ':'Loading balance'}/>}</span><small>ETB</small></span></WalletOverviewTrigger>
   <WalletTopUpTrigger className={styles.addFunds} ariaLabel={am?'ገንዘብ ያስገቡ':'Deposit'}><Plus size={15} strokeWidth={1.75} aria-hidden="true"/></WalletTopUpTrigger>
  </div>:environment==='mini'?<MiniAccountAction className={styles.login}/>:status==='loading'||environment==='detecting'?<span className={styles.restoring} role="status" aria-label={am?'መለያ በማስመለስ ላይ':'Restoring account'}><span/></span>:<button className={styles.login} type="button" onClick={openRegistration}><LogIn size={14} aria-hidden="true"/>{am?'ይግቡ':'Log in'}</button>}
  <nav className={styles.actions} aria-label={am?'የመለያ ቁጥጥሮች':'Account controls'}>
  <AuctionQuickList className={styles.icon}/>
  <AlertBell className={styles.icon}/>
  {registered&&<IntentPrefetchLink ref={affiliateLinkRef} href="/affiliate" className={styles.affiliate} aria-describedby={promoReward?affiliatePromoId:undefined}>
   <Gift size={17} strokeWidth={1.8} aria-hidden="true"/>
   <span>{am?'ግብዣ':'Affiliate'}</span>
  </IntentPrefetchLink>}
  <div className={styles.language} ref={languageRef}>
   <button ref={languageButtonRef} type="button" className={styles.languageButton} aria-label={`${t('language')}: ${language==='en'?'English':'አማርኛ'}`} aria-haspopup="menu" aria-controls={languageMenuId} aria-expanded={languageOpen} onClick={()=>setLanguageOpen(open=>!open)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setLanguageOpen(true)}}}><Languages size={16} strokeWidth={1.75} aria-hidden="true"/><span aria-hidden="true">{language==='en'?'EN':'አማ'}</span><ChevronDown className={styles.languageChevron} data-open={languageOpen} size={10} strokeWidth={1.75} aria-hidden="true"/></button>
   {languageOpen&&<div ref={languageMenuRef} id={languageMenuId} className={styles.languageMenu} role="menu" aria-label={t('language')} onKeyDown={moveLanguageFocus}>{([['en','English'],['am','አማርኛ']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={language===value} className={styles.languageOption} key={value} lang={value} onClick={()=>{setLanguage(value as MiniLanguage);setLanguageOpen(false);languageButtonRef.current?.focus()}}><span>{label}</span>{language===value&&<Check size={15} strokeWidth={1.75} aria-hidden="true"/>}</button>)}</div>}
  </div>
  {promoReward&&<aside className={styles.affiliatePromo} aria-label={am?'የግብዣ ሽልማት':'Referral reward'}>
   <div id={affiliatePromoId} className={styles.affiliatePromoCopy}>
    <strong>{am?'ጓደኛ ይጋብዙ፣ ሽልማት ያግኙ':'Invite friends and earn'}</strong>
    <p>{am?`በሊንክዎ የተመዘገበ ጓደኛ የመጀመሪያው ጨረታ ሲቀበል ${promoReward} ብር ወደ ዋሌትዎ ይገባል።`:`Get ${formatEtb(promoReward)} in your wallet when a friend joins through your link and places their first accepted bid.`}</p>
   </div>
   <button type="button" className={styles.affiliatePromoClose} aria-label={am?'የግብዣ ማስታወቂያውን ዝጋ':'Dismiss referral message'} onClick={event=>dismissAffiliatePromo(event.detail===0)}><X size={17} aria-hidden="true"/></button>
  </aside>}
  </nav>
  </div>
 </header>;
}
