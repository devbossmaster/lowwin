'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {AlertCircle,LoaderCircle,ShieldCheck} from 'lucide-react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {telegramBrowserLoginDestination,telegramBrowserLoginError,telegramBrowserLoginStart,type TelegramBrowserLoginError} from '@/lib/telegram-browser-login-client';
import {AccountSheet} from './account-sheet';
import {MiniPhrase,useMiniLocale} from './mini-locale';
import {useTelegram} from './telegram-provider';
import {TelegramBotLink} from './telegram-bot-link';
import styles from './browser-telegram-login.module.css';

type Configuration={enabled:boolean;configured:boolean};
const feedback:Record<TelegramBrowserLoginError,{en:string;am:string}>={
 cancelled:{en:'Sign-in was cancelled. You can try again or keep browsing.',am:'መግባት ተሰርዟል። እንደገና ይሞክሩ ወይም መመልከት ይቀጥሉ።'},
 expired:{en:'This sign-in request expired. Start again to continue.',am:'የመግቢያ ጥያቄው ጊዜ አልፎበታል። ለመቀጠል እንደገና ይጀምሩ።'},
 unavailable:{en:'Telegram sign-in is temporarily unavailable. Please try again.',am:'በTelegram መግባት ለጊዜው አይገኝም። እንደገና ይሞክሩ።'},
 invalid:{en:'We could not confirm this sign-in. Please start again.',am:'ይህን መግቢያ ማረጋገጥ አልቻልንም። እንደገና ይጀምሩ።'},
 contact_required:{en:'Telegram did not confirm a phone number. Allow phone sharing when signing in, or finish contact registration in the Lowwin bot.',am:'Telegram ስልክ ቁጥር አላረጋገጠም። ሲገቡ ስልክ ቁጥር ማጋራትን ይፍቀዱ ወይም ምዝገባዎን በLowwin ቦት ያጠናቅቁ።'},
 conflict:{en:'This Telegram account could not be connected safely. Try your original account or contact Lowwin support.',am:'ይህን የTelegram መለያ በደህንነት ማገናኘት አልቻልንም። በመጀመሪያው መለያዎ ይሞክሩ ወይም Lowwin ድጋፍን ያነጋግሩ።'},
};
function TelegramMark(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m20.7 4.3-3.1 15.1c-.2 1.1-.9 1.3-1.8.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.8 8.7-7.9c.4-.3-.1-.5-.6-.2L5.5 13.3.9 11.9c-1-.3-1-1 .2-1.5L19.2 3.4c.8-.3 1.7.2 1.5.9Z"/></svg>}

/** Browser identity uses Telegram's own approval page; Lowwin collects no code or PIN. */
export default function BrowserTelegramLogin(){
 const {language}=useMiniLocale(),{status,retry,closeRegistration,botUrl}=useTelegram();
 const [pending,setPending]=useState(false),[navigationError,setNavigationError]=useState(false),[errorCode]=useState(()=>typeof window==='undefined'?null:telegramBrowserLoginError(new URLSearchParams(window.location.search).get('telegramLoginError')));
 const redirecting=useRef(false);
 const configuration=useQuery<Configuration>({queryKey:['public','telegram-browser-login','configuration'],queryFn:async({signal})=>{const response=await fetch('/api/auth/telegram/browser/config',{signal,credentials:'same-origin'});if(!response.ok)throw Error('Configuration unavailable');const result=await response.json();if(typeof result.enabled!=='boolean'||typeof result.configured!=='boolean')throw Error('Configuration unavailable');return result},staleTime:60_000,gcTime:300_000,retry:false,refetchOnWindowFocus:false});
 useEffect(()=>{const resumed=()=>{redirecting.current=false;setPending(false)};window.addEventListener('pageshow',resumed);return()=>window.removeEventListener('pageshow',resumed)},[]);
 function clearFeedback(){const url=new URL(window.location.href);if(url.searchParams.has('telegramLoginError')){url.searchParams.delete('telegramLoginError');url.searchParams.delete('next');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}}
 function close(){clearFeedback();closeRegistration()}
 function start(){
  if(redirecting.current||!configuration.data?.enabled||!configuration.data.configured||status==='loading')return;
  const destination=telegramBrowserLoginDestination(window.location);
  redirecting.current=true;setPending(true);setNavigationError(false);clearFeedback();
  try{window.location.assign(telegramBrowserLoginStart(destination,language))}catch{redirecting.current=false;setPending(false);setNavigationError(true)}
 }
 const ready=configuration.data?.enabled===true&&configuration.data.configured===true,restoring=status==='loading';
 const notice=errorCode?feedback[errorCode][language]:navigationError?(language==='am'?'Telegramን መክፈት አልቻልንም። እንደገና ይሞክሩ።':'Telegram could not open. Please try again.'):null;
 return <AccountSheet title={<span className={styles.brand}><img src={LOWWIN_LOGO_SRC} width={27} height={27} alt=""/>Lowwin</span>} onClose={close} presentation="centered">
  <div className={styles.content} data-browser-telegram-login>
   <h3><MiniPhrase en="Sign in to continue" am="ለመቀጠል ይግቡ"/></h3>
   <p className={styles.lead}><MiniPhrase en="Keep your bids, wallet and rewards together in your Lowwin account." am="ጨረታዎችዎን፣ ዋሌትዎን እና ሽልማቶችዎን በLowwin መለያዎ አንድ ላይ ያስቀምጡ።"/></p>
   {notice&&<p className={styles.notice} role="alert"><AlertCircle size={17} aria-hidden="true"/><span>{notice}</span></p>}
   {restoring?<p className={styles.loading} role="status"><LoaderCircle size={17} className={styles.spin} aria-hidden="true"/><MiniPhrase en="Restoring your account…" am="መለያዎን በመመለስ ላይ…"/></p>:status==='error'?<div className={styles.unavailable}><p role="status"><MiniPhrase en="Your account could not load. Reconnect before signing in again." am="መለያዎን መጫን አልቻልንም። እንደገና ከመግባትዎ በፊት ዳግም ይገናኙ።"/></p><button className={styles.secondary} onClick={retry}><MiniPhrase en="Reconnect" am="እንደገና ይገናኙ"/></button></div>:<>
    <button className={styles.primary} type="button" disabled={!ready||pending} onClick={start} aria-busy={pending}>{pending?<LoaderCircle size={20} className={styles.spin} aria-hidden="true"/>:<TelegramMark/>}<MiniPhrase en={pending?'Opening Telegram…':'Continue with Telegram'} am={pending?'Telegram በመክፈት ላይ…':'በTelegram ይቀጥሉ'}/></button>
    {configuration.isPending&&<p className={styles.status} role="status"><MiniPhrase en="Preparing secure sign-in…" am="ደህንነቱ የተጠበቀ መግቢያ በማዘጋጀት ላይ…"/></p>}
    {(configuration.isError||configuration.data&&!ready)&&<div className={styles.unavailable}><p role="status"><MiniPhrase en="Telegram sign-in is not available right now." am="በTelegram መግባት አሁን አይገኝም።"/></p><button type="button" className={styles.retry} onClick={()=>void configuration.refetch()} disabled={configuration.isFetching}><MiniPhrase en="Try again" am="እንደገና ይሞክሩ"/></button></div>}
   </>}
   <p className={styles.explanation}><MiniPhrase en="Approve on Telegram, then return here. Use the same Telegram account to access your existing wallet and bids." am="በTelegram ያጽድቁና ወደዚህ ይመለሱ። ዋሌትዎን እና ጨረታዎችዎን ለመቀጠል ተመሳሳይ የTelegram መለያ ይጠቀሙ።"/></p>
   {errorCode==='contact_required'&&botUrl&&<TelegramBotLink className={styles.secondary} href={botUrl}><MiniPhrase en="Finish registration in Telegram" am="ምዝገባን በTelegram ያጠናቅቁ"/></TelegramBotLink>}
   <button type="button" className={styles.browse} onClick={close}><MiniPhrase en="Keep browsing" am="መመልከት ይቀጥሉ"/></button>
   <p className={styles.security}><ShieldCheck size={14} aria-hidden="true"/><MiniPhrase en="Secure sign-in through Telegram" am="በTelegram ደህንነቱ የተጠበቀ መግቢያ"/></p>
  </div>
 </AccountSheet>;
}
