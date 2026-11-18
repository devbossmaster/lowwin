'use client';
import {useEffect,useRef,useState} from 'react';
import {AlertCircle,LoaderCircle,ShieldCheck} from 'lucide-react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {botRegistrationReferralUrl,referralCodeFromParams,REFERRAL_BOT_RECOVERY_PARAMETER} from '@/lib/referral-invite';
import {requestTelegramBrowserLogin,telegramBrowserLoginDestination,telegramBrowserLoginError,type TelegramBrowserLoginError,type TelegramBrowserLoginConfiguration} from '@/lib/telegram-browser-login-client';
import {rememberTelegramAuthResume} from '@/lib/telegram-auth-resume';
import {AccountSheet} from './account-sheet';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {TelegramBotLink} from './telegram-bot-link';
import styles from './browser-telegram-login.module.css';

const feedback:Record<TelegramBrowserLoginError,{en:string;am:string}>={
 cancelled:{en:'Sign-in was cancelled. You can try again or keep browsing.',am:'መግባት ተሰርዟል። እንደገና ይሞክሩ ወይም መመልከት ይቀጥሉ።'},
 expired:{en:'This sign-in request expired. Start again to continue.',am:'የመግቢያ ጥያቄው ጊዜ አልፎበታል። ለመቀጠል እንደገና ይጀምሩ።'},
 unavailable:{en:'Telegram sign-in is temporarily unavailable. Please try again.',am:'በTelegram መግባት ለጊዜው አይገኝም። እንደገና ይሞክሩ።'},
 invalid:{en:'We could not confirm this sign-in. Please start again.',am:'ይህን መግቢያ ማረጋገጥ አልቻልንም። እንደገና ይጀምሩ።'},
 contact_required:{en:'Telegram did not confirm a phone number. Allow phone sharing when signing in, or finish contact registration in the LowWin bot.',am:'Telegram ስልክ ቁጥር አላረጋገጠም። ሲገቡ ስልክ ቁጥር ማጋራትን ይፍቀዱ ወይም ምዝገባዎን በLowWin ቦት ያጠናቅቁ።'},
 conflict:{en:'This Telegram account could not be connected safely. Try your original account or contact LowWin support.',am:'ይህን የTelegram መለያ በደህንነት ማገናኘት አልቻልንም። በመጀመሪያው መለያዎ ይሞክሩ ወይም LowWin ድጋፍን ያነጋግሩ።'},
};
function TelegramMark(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m20.7 4.3-3.1 15.1c-.2 1.1-.9 1.3-1.8.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.8 8.7-7.9c.4-.3-.1-.5-.6-.2L5.5 13.3.9 11.9c-1-.3-1-1 .2-1.5L19.2 3.4c.8-.3 1.7.2 1.5.9Z"/></svg>}

/** Browser identity uses Telegram's own approval page; LowWin collects no code or PIN. */
export default function BrowserTelegramLogin({configuration}:{configuration:TelegramBrowserLoginConfiguration}){
 const {language}=useMiniLocale(),{status,me,retry,closeRegistration,botUrl}=useTelegram();
 const [pending,setPending]=useState(false),[errorCode,setErrorCode]=useState<TelegramBrowserLoginError|'network'|null>(()=>typeof window==='undefined'?null:telegramBrowserLoginError(new URLSearchParams(window.location.search).get('telegramLoginError')));
 const [registrationReferral]=useState(()=>{
  if(typeof window==='undefined')return null;
  const query=new URLSearchParams(window.location.search);
  return (query.get('telegramLoginError')==='contact_required'?referralCodeFromParams(query,REFERRAL_BOT_RECOVERY_PARAMETER):null)??referralCodeFromParams(query);
 });
 const registrationBotUrl=botRegistrationReferralUrl(botUrl,registrationReferral);
 const navigation=useRef<AbortController|null>(null);
 const ready=configuration.enabled&&configuration.configured,restoring=status==='loading',sessionUnavailable=status==='error';
 const canChooseSignIn=!restoring&&!sessionUnavailable;
 useEffect(()=>{
  const resumed=(event:PageTransitionEvent)=>{if(event.persisted){navigation.current?.abort();navigation.current=null;setPending(false)}};
  window.addEventListener('pageshow',resumed);
  return()=>{window.removeEventListener('pageshow',resumed);navigation.current?.abort();navigation.current=null};
 },[]);
 function clearFeedback(){const url=new URL(window.location.href);if(url.searchParams.has('telegramLoginError')){url.searchParams.delete('telegramLoginError');url.searchParams.delete(REFERRAL_BOT_RECOVERY_PARAMETER);url.searchParams.delete('next');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}}
 function close(){navigation.current?.abort();navigation.current=null;clearFeedback();closeRegistration()}
 async function start(){
  if(navigation.current||!ready||!canChooseSignIn)return;
  const controller=new AbortController();navigation.current=controller;
  setPending(true);setErrorCode(null);
  try{
   const current=telegramBrowserLoginDestination(window.location);
   const saved=rememberTelegramAuthResume(current,me?.user?.id??null,{scrollY:window.scrollY});
   const url=await requestTelegramBrowserLogin(saved?.draft?saved.destination:current,language,controller.signal);
   if(navigation.current!==controller||controller.signal.aborted)return;
   clearFeedback();window.location.assign(url);
  }catch{
   if(navigation.current!==controller)return;
   navigation.current=null;setPending(false);setErrorCode('network');
  }
 }
 const notice=errorCode==='network'?(language==='am'?'Telegramን መክፈት አልቻልንም። ግንኙነትዎን ያረጋግጡና እንደገና ይሞክሩ።':'Telegram could not open. Check your connection and try again.'):errorCode?feedback[errorCode][language]:null;
 return <AccountSheet title={<span className={styles.brand}><img src={LOWWIN_LOGO_SRC} width={27} height={27} alt=""/>LowWin</span>} onClose={close} presentation="centered">
  <div className={styles.content} data-browser-telegram-login>
   <h3><MiniPhrase en="Sign in or create an account" am="ይግቡ ወይም ይመዝገቡ"/></h3>
   <p className={styles.lead}><MiniPhrase en="Continue with Telegram. If you're new, we'll create your LowWin account in the same step." am="በTelegram ይቀጥሉ። አዲስ ከሆኑ የLowWin መለያዎ በዚሁ ይፈጠራል።"/></p>
   {notice&&canChooseSignIn&&<p className={styles.notice} role="alert"><AlertCircle size={17} aria-hidden="true"/><span>{notice}</span></p>}
   {restoring&&<p className={styles.loading} role="status"><LoaderCircle size={17} className={styles.spin} aria-hidden="true"/><MiniPhrase en="Restoring your account…" am="መለያዎን በመመለስ ላይ…"/></p>}
   {sessionUnavailable&&<div className={styles.unavailable}><p role="status"><MiniPhrase en="We couldn’t check your session. Check your connection and try again." am="መግቢያዎን ማረጋገጥ አልቻልንም። ግንኙነትዎን ያረጋግጡና እንደገና ይሞክሩ።"/></p><button type="button" className={styles.primary} onClick={retry}><MiniPhrase en="Retry connection" am="ግንኙነቱን እንደገና ይሞክሩ"/></button></div>}
   {canChooseSignIn&&<>
    {ready?<button className={styles.primary} type="button" disabled={pending} onClick={start} aria-busy={pending}>{pending?<LoaderCircle size={20} className={styles.spin} aria-hidden="true"/>:<TelegramMark/>}<MiniPhrase en={pending?'Opening Telegram…':'Continue with Telegram'} am={pending?'Telegram በመክፈት ላይ…':'በTelegram ይቀጥሉ'}/></button>:<div className={styles.unavailable}><p role="status"><MiniPhrase en="Website sign-in is currently unavailable. You can use LowWin in Telegram or keep browsing." am="የድረ ገጽ መግቢያ ለጊዜው አይገኝም። LowWinን በTelegram ይክፈቱ ወይም መመልከት ይቀጥሉ።"/></p>{registrationBotUrl&&<TelegramBotLink className={styles.primary} href={registrationBotUrl}><TelegramMark/><MiniPhrase en="Open LowWin in Telegram" am="LowWinን በTelegram ይክፈቱ"/></TelegramBotLink>}</div>}
   </>}
   {ready&&canChooseSignIn&&<p className={styles.explanation}><MiniPhrase en="For a new account, allow phone sharing on Telegram. Use the same Telegram account here and in the bot to keep your wallet and bids." am="ለአዲስ መለያ ስልክ ቁጥርዎን በTelegram ለማጋራት ይፍቀዱ። ዋሌትዎን እና ጨረታዎችዎን ለመቀጠል እዚህና በቦቱ ተመሳሳይ የTelegram መለያ ይጠቀሙ።"/></p>}
   {canChooseSignIn&&errorCode==='contact_required'&&registrationBotUrl&&<TelegramBotLink className={styles.secondary} href={registrationBotUrl}><MiniPhrase en="Finish registration in Telegram" am="ምዝገባን በTelegram ያጠናቅቁ"/></TelegramBotLink>}
   <button type="button" className={styles.browse} onClick={close}><MiniPhrase en="Keep browsing" am="መመልከት ይቀጥሉ"/></button>
   <p className={styles.security}><ShieldCheck size={14} aria-hidden="true"/><MiniPhrase en="Secure sign-in through Telegram" am="በTelegram ደህንነቱ የተጠበቀ መግቢያ"/></p>
  </div>
 </AccountSheet>;
}
