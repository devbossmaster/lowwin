'use client';

import {useEffect,useRef,useState} from 'react';
import {Check,Copy,Gift,Globe2,Send,Share2,UsersRound,Wallet} from 'lucide-react';
import type {getReferralOverview} from '@/modules/referrals/service';
import {referralShareCopy} from '@/lib/referral-share';
import {formatEtb} from '@/lib/money';
import {formatAddisTimestamp} from '@/lib/addis-time';
import {useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {Button} from './ui/button';
import {Card} from './ui/card';
import styles from './affiliate-page.module.css';

export type ReferralOverview=Awaited<ReturnType<typeof getReferralOverview>>;

export function ReferralShareCard({overview}:{overview:ReferralOverview}){
 const {environment}=useTelegram(),{language}=useMiniLocale();
 const text=(en:string,am:string)=>language==='am'?am:en;
 const inTelegram=environment==='mini';
 const shareUrl=overview.enabled?(inTelegram?overview.shareUrl:overview.webShareUrl):null;
 const reward=shareUrl&&overview.rewardEtb?formatEtb(overview.rewardEtb):null;
 const paused=overview.configured&&!overview.enabled;
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

 return <div className={styles.content} lang={language} data-referral-channel={inTelegram?'telegram':'website'}>
  <section className={styles.hero} data-active={!!reward||undefined} aria-labelledby="refer-heading">
   <h2 id="refer-heading">{text('Invite & earn','ይጋብዙ እና ያግኙ')}</h2>
   {reward&&<div className={styles.reward}><Gift size={23} aria-hidden="true"/><strong>{reward}</strong></div>}
   <p>{reward?text('Earn once per friend when they sign up with your link and place their first accepted bid. Your reward goes straight to your wallet.','በሊንክዎ የተመዘገበ ጓደኛ የመጀመሪያው ጨረታ ሲቀበል፣ ሽልማቱ በቀጥታ ወደ ዋሌትዎ ይገባል። ለእያንዳንዱ ጓደኛ አንድ ጊዜ ያገኛሉ።'):
    paused?text('New invitations are paused. Rewards you already earned stay in your wallet.','አዲስ ግብዣዎች ቆመዋል። ያገኙት ሽልማት በዋሌትዎ ይቆያል።'):
    text('Your invite link is currently unavailable.','የመጋበዣ ሊንክዎ ለጊዜው አይገኝም።')}</p>
  </section>
  {shareUrl&&<Card className={styles.invite} role="region" aria-labelledby="affiliate-invite">
   <h2 id="affiliate-invite">{inTelegram?<Send size={17} aria-hidden="true"/>:<Globe2 size={17} aria-hidden="true"/>}{inTelegram?text('Telegram invite link','የቴሌግራም ግብዣ ሊንክ'):text('Website invite link','የድረ ገጽ ግብዣ ሊንክ')}</h2>
   <input className={styles.link} ref={linkInput} readOnly dir="ltr" value={shareUrl} aria-label={text('Your referral link','የመጋበዣ ሊንክዎ')}/>
   <div className={styles.actions}>
    <Button className={styles.shareButton} type="button" disabled={sharing} onClick={()=>void shareLink()}>
     <Share2 size={17} aria-hidden="true"/>{sharing?text('Opening…','በመክፈት ላይ…'):inTelegram?text('Share in Telegram','በቴሌግራም ያጋሩ'):text('Share my link','ሊንኬን አጋራ')}
    </Button>
    <Button className={styles.copyButton} type="button" variant="outline" onClick={()=>void copyLink()} aria-label={text('Copy referral link','የመጋበዣ ሊንክ ይቅዱ')}>
     {copied?<Check size={19} aria-hidden="true"/>:<Copy size={19} aria-hidden="true"/>}
    </Button>
   </div>
   {notice&&<p className={styles.notice} role="status">{notice}</p>}
  </Card>}
  {overview.configured&&<section className={styles.activity} aria-labelledby="affiliate-earnings">
   <Card className={styles.earnings}>
    <h2 id="affiliate-earnings"><Wallet size={17} aria-hidden="true"/>{text('Referral earnings','የግብዣ ገቢ')}</h2>
    <strong>{formatEtb(overview.totalEarnedEtb)}</strong>
   </Card>
   <dl className={styles.stats}>{[
    {label:text('Signed up','የተመዘገቡ'),value:overview.counts.signedUp},
    {label:text('First bids','የመጀመሪያ ጨረታዎች'),value:overview.counts.qualified},
    {label:text('Rewards earned','የተገኙ ሽልማቶች'),value:overview.counts.earned},
   ].map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value.toLocaleString(language==='am'?'am-ET':'en-ET')}</dd></div>)}</dl>
  </section>}
  {overview.configured&&<Card className={styles.history} role="region" aria-labelledby="affiliate-invites">
   <h2 id="affiliate-invites">{text('Recent invitations','የቅርብ ጊዜ ግብዣዎች')}</h2>
   {overview.recentInvites.length>0?<table aria-labelledby="affiliate-invites">
    <thead><tr><th scope="col">{text('Registered','የተመዘገቡበት')}</th><th scope="col">{text('First bid','የመጀመሪያ ጨረታ')}</th></tr></thead>
    <tbody>{overview.recentInvites.map((invite,index)=><tr key={`${invite.registeredAt}-${index}`}>
     <td><time dateTime={invite.registeredAt}>{formatAddisTimestamp(invite.registeredAt,language==='am'?'am-ET':'en-GB')}</time></td>
     <td><span className={styles.inviteStatus} data-complete={invite.firstBidAccepted||undefined}>{invite.firstBidAccepted?text('Accepted','ተቀብሏል'):text('Pending','በመጠባበቅ ላይ')}</span></td>
    </tr>)}</tbody>
   </table>:<p className={styles.empty}><UsersRound size={21} aria-hidden="true"/>{text('No one has registered with your link yet.','በሊንክዎ የተመዘገበ ሰው ገና የለም።')}</p>}
  </Card>}
 </div>;
}
