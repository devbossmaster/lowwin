'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Gift,LogIn,Plus,Wallet,X} from 'lucide-react';
import {AuctionQuickList} from './auction-quick-list';
import {AlertBell} from './alert-bell';
import {WalletTopUpTrigger} from './wallet-top-up-trigger';
import {WalletOverviewTrigger} from './wallet-overview-trigger';
import {useTelegram} from './telegram-provider';
import {usePrivateQuery} from './private-query';
import {centsToEtb,etbToCents,formatEtb} from '@/lib/money';
import type {WalletBalance} from '@/modules/wallet/balance';
import {useMiniLocale} from './mini-locale';
import {MiniLanguageMenu} from './mini-language-menu';
import styles from './mini-header.module.css';
import {LOWWIN_BRAND_NAME} from '@/lib/brand';
import {BrandMark} from './brand-mark';
import {MiniAccountAction} from './mini-account-action';
import {IntentPrefetchLink} from './intent-prefetch-link';

const affiliatePromoDismissedKey='lowwin-affiliate-promo-dismissed';
type ReferralPromoPolicy={configured:boolean;enabled:boolean;rewardEtb:string|null};

export function MiniHeader({showReferralPromo}:{showReferralPromo:boolean}){
 const {language}=useMiniLocale();
 const {status,me,queryIdentity,openRegistration,environment}=useTelegram(),am=language==='am',path=usePathname();
 // This account is set only after the server confirms registration. A contact
 // sharing callback must never make a guest eligible for private wallet reads.
 const registered=status==='authenticated'&&!!me&&!!queryIdentity;
 const wallet=usePrivateQuery<WalletBalance>('/api/wallet',{enabled:registered&&path==='/',freshnessMs:15000,pollMs:60000});
 const [affiliatePromoDismissed,setAffiliatePromoDismissed]=useState<boolean|null>(null);
 const affiliatePromoId=useId();
 const affiliateLinkRef=useRef<HTMLAnchorElement>(null);
 const affiliatePromoCloseRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  try{setAffiliatePromoDismissed(sessionStorage.getItem(affiliatePromoDismissedKey)==='1')}
  catch{setAffiliatePromoDismissed(false)}
 },[]);
 const affiliatePromoEligible=registered&&path==='/'&&showReferralPromo&&affiliatePromoDismissed===false;
 const referralPolicy=usePrivateQuery<ReferralPromoPolicy>('/api/referrals?view=policy',{
  enabled:affiliatePromoEligible,
  freshnessMs:60000,
  cancelOnUnmount:true,
 });
 const promoPolicy=affiliatePromoEligible&&!referralPolicy.error?referralPolicy.data:null;
 const promoReward=promoPolicy?.configured&&promoPolicy.enabled?promoPolicy.rewardEtb:null;
 const affiliatePromoVisible=Boolean(promoReward);
 const dismissAffiliatePromo=useCallback((restoreFocus:boolean)=>{
  setAffiliatePromoDismissed(true);
  try{sessionStorage.setItem(affiliatePromoDismissedKey,'1')}catch{/* This mount still remembers the dismissal. */}
  if(restoreFocus)affiliateLinkRef.current?.focus({preventScroll:true});
 },[]);
 useEffect(()=>{
  if(!affiliatePromoVisible)return;
  const timeout=window.setTimeout(()=>dismissAffiliatePromo(document.activeElement===affiliatePromoCloseRef.current),3000);
  return()=>window.clearTimeout(timeout);
 },[affiliatePromoVisible,dismissAffiliatePromo]);
 let amount:string|null=null;
 try{if(wallet.data)amount=centsToEtb(etbToCents(wallet.data.available))}catch{/* Unavailable amounts are never displayed as zero. */}
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
  <MiniLanguageMenu/>
  {promoReward&&<aside className={styles.affiliatePromo} aria-label={am?'የግብዣ ሽልማት':'Referral reward'}>
   <div id={affiliatePromoId} className={styles.affiliatePromoCopy}>
    <strong>{am?'ጓደኛ ይጋብዙ፣ ሽልማት ያግኙ':'Invite friends and earn'}</strong>
    <p>{am?`በሊንክዎ የተመዘገበ ጓደኛ የመጀመሪያው ጨረታ ሲቀበል ${promoReward} ብር ወደ ዋሌትዎ ይገባል።`:`Get ${formatEtb(promoReward)} in your wallet when a friend joins through your link and places their first accepted bid.`}</p>
   </div>
   <button ref={affiliatePromoCloseRef} type="button" className={styles.affiliatePromoClose} aria-label={am?'የግብዣ ማስታወቂያውን ዝጋ':'Dismiss referral message'} onClick={event=>dismissAffiliatePromo(event.detail===0)}><X size={17} aria-hidden="true"/></button>
  </aside>}
  </nav>
  </div>
 </header>;
}
