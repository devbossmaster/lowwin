'use client';

import {useEffect,useRef,useState} from 'react';
import {Check,Copy,Globe2,Send,Share2,UsersRound} from 'lucide-react';
import type {getReferralOverview} from '@/modules/referrals/service';
import {referralShareCopy} from '@/lib/referral-share';
import {formatEtb} from '@/lib/money';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import styles from './profile-page.module.css';

export type ReferralOverview=Awaited<ReturnType<typeof getReferralOverview>>;

export function ReferralShareCard({overview}:{overview?:ReferralOverview}){
 const {environment}=useTelegram(),{language}=useMiniLocale();
 const text=(en:string,am:string)=>language==='am'?am:en;
 const inTelegram=environment==='mini';
 const shareUrl=overview?.enabled?(inTelegram?overview.shareUrl:overview.webShareUrl):null;
 const knownRewards=!!overview?.configured;
 const [sharing,setSharing]=useState(false),[copied,setCopied]=useState(false),[notice,setNotice]=useState('');
 const linkInput=useRef<HTMLInputElement>(null);
 const currentShare=useRef<AbortController|null>(null);
 useEffect(()=>()=>currentShare.current?.abort(),[]);
 useEffect(()=>{setCopied(false);setNotice('')},[language,shareUrl]);

 async function copyLink(){
  if(!shareUrl)return;
  setNotice('');setCopied(false);
  try{
   await navigator.clipboard.writeText(shareUrl);
   setCopied(true);
   setNotice(text('Link copied.','ሊንኩ ተቀድቷል።'));
  }catch{
   linkInput.current?.focus();linkInput.current?.select();
   setNotice(text('Press and hold the link to copy it.','ሊንኩን ለመቅዳት ተጭነው ይያዙት።'));
  }
 }

 async function shareLink(){
  if(!shareUrl||currentShare.current)return;
  const controller=new AbortController();
  currentShare.current=controller;
  setSharing(true);setNotice('');
  const copy=referralShareCopy[language];
  try{
   if(inTelegram){
    const app=window.Telegram?.WebApp;
    try{
     if(app?.shareMessage&&(!app.isVersionAtLeast||app.isVersionAtLeast('8.0'))){
      const response=await fetch('/api/referrals/telegram-share',{
       method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language}),
       cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6500)]),
      });
      if(response.ok){
       const prepared:unknown=await response.json();
       if(prepared&&typeof prepared==='object'&&'id' in prepared&&typeof prepared.id==='string'&&prepared.id.length>0&&prepared.id.length<=512&&!controller.signal.aborted){
        app.shareMessage(prepared.id);
        return;
       }
      }
     }
    }catch{/* The Telegram link below also works when a photo cannot be prepared. */}
    if(controller.signal.aborted)return;
    if(app?.openTelegramLink){
     try{
      app.openTelegramLink('https://t.me/share/url?'+new URLSearchParams({url:shareUrl,text:copy.caption}));
      return;
     }catch{/* Continue with device sharing or copy. */}
    }
   }
   if(navigator.share){
    try{
     await navigator.share({title:copy.title,text:copy.caption,url:shareUrl});
     return;
    }catch(error){if(error instanceof DOMException&&error.name==='AbortError')return}
   }
   if(!controller.signal.aborted)await copyLink();
  }finally{
   currentShare.current=null;
   if(!controller.signal.aborted)setSharing(false);
  }
 }

 return <section className={`${styles.panel} ${styles.referralPanel}`} data-referral-channel={inTelegram?'telegram':'website'} aria-labelledby="refer-heading">
  <div className={styles.panelHeading}>
   <h2 id="refer-heading"><UsersRound size={19} aria-hidden="true"/>{text('Refer & earn','ይጋብዙ እና ያግኙ')}</h2>
   <span className={styles.referralState} data-active={!!shareUrl||undefined}>{shareUrl?text('Active','ንቁ'):knownRewards&&!overview.enabled?text('Paused','ቆሟል'):text('Unavailable','አይገኝም')}</span>
  </div>
  <p className={styles.description}>{shareUrl&&overview?.rewardEtb?
   text(`Earn ${formatEtb(overview.rewardEtb)} in your wallet when a friend signs up with your link and places their first accepted bid. You earn once per friend.`,`በሊንክዎ የተመዘገበ ጓደኛ የመጀመሪያው ጨረታ ሲቀበል፣ ${overview.rewardEtb} ብር ወደ ዋሌትዎ ይገባል። ለእያንዳንዱ ጓደኛ አንድ ጊዜ ያገኛሉ።`):
   knownRewards&&!overview.enabled?text('New invitations are paused. Rewards you already earned stay in your wallet.','አዲስ ግብዣዎች ቆመዋል። ያገኙት ሽልማት በዋሌትዎ ይቆያል።'):
   text('Your invitation link and reward terms will appear here when Refer & earn is ready.','የመጋበዣ ሊንክዎ እና የሽልማት ውሎች አገልግሎቱ ሲዘጋጅ እዚህ ይታያሉ።')}</p>
  {shareUrl&&<>
   <p className={styles.referralChannel}>{inTelegram?<Send size={13} aria-hidden="true"/>:<Globe2 size={13} aria-hidden="true"/>}{inTelegram?text('Telegram invite link','የቴሌግራም ግብዣ ሊንክ'):text('Website invite link','የድረ ገጽ ግብዣ ሊንክ')}</p>
   <div className={styles.referralLink}>
    <input ref={linkInput} readOnly dir="ltr" value={shareUrl} aria-label={text('Your referral link','የመጋበዣ ሊንክዎ')}/>
    <button type="button" onClick={()=>void copyLink()} aria-label={text('Copy referral link','የመጋበዣ ሊንክ ይቅዱ')}>{copied?<Check size={17} aria-hidden="true"/>:<Copy size={17} aria-hidden="true"/>}</button>
   </div>
   <button className={styles.shareButton} type="button" disabled={sharing} onClick={()=>void shareLink()}>
    <Share2 size={17} aria-hidden="true"/>{sharing?text('Opening…','በመክፈት ላይ…'):inTelegram?text('Share in Telegram','በቴሌግራም ያጋሩ'):text('Share my link','ሊንኬን አጋራ')}
   </button>
  </>}
  {notice&&<p className={styles.inlineNotice} role="status">{notice}</p>}
  <div className={styles.referralStats}>{[
   {label:text('Signed up','የተመዘገቡ'),value:knownRewards?overview.counts.signedUp:null},
   {label:text('First bids','የመጀመሪያ ጨረታዎች'),value:knownRewards?overview.counts.qualified:null},
   {label:text('Rewards earned','የተገኙ ሽልማቶች'),value:knownRewards?overview.counts.earned:null},
  ].map(item=><div key={item.label}><strong>{item.value??'—'}</strong><span>{item.label}</span></div>)}</div>
 </section>;
}
