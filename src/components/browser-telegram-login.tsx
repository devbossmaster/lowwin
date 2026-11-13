'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {AlertCircle,LoaderCircle,ShieldCheck} from 'lucide-react';
import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import {loadTelegramBrowserLoginConfiguration,telegramBrowserLoginDestination,telegramBrowserLoginError,telegramBrowserLoginStart,type TelegramBrowserLoginError,type TelegramBrowserLoginConfiguration} from '@/lib/telegram-browser-login-client';
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
export default function BrowserTelegramLogin(){
 const {language}=useMiniLocale(),{status,closeRegistration,botUrl}=useTelegram();
 const [pending,setPending]=useState(false),[navigationError,setNavigationError]=useState(false),[errorCode]=useState(()=>typeof window==='undefined'?null:telegramBrowserLoginError(new URLSearchParams(window.location.search).get('telegramLoginError')));
 const redirecting=useRef(false);
 const configuration=useQuery<TelegramBrowserLoginConfiguration>({queryKey:['public','telegram-browser-login','configuration'],queryFn:({signal})=>loadTelegramBrowserLoginConfiguration(signal),staleTime:60_000,gcTime:300_000,retry:false,networkMode:'always',refetchOnWindowFocus:false});
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
 return <AccountSheet title={<span className={styles.brand}><img src={LOWWIN_LOGO_SRC} width={27} height={27} alt=""/>LowWin</span>} onClose={close} presentation="centered">
  <div className={styles.content} data-browser-telegram-login>
   <h3><MiniPhrase en="Sign in to continue" am="ለመቀጠል ይግቡ"/></h3>
   <p className={styles.lead}><MiniPhrase en="Keep your bids, wallet and rewards together in your LowWin account." am="ጨረታዎችዎን፣ ዋሌትዎን እና ሽልማቶችዎን በLowWin መለያዎ አንድ ላይ ያስቀምጡ።"/></p>
   {notice&&<p className={styles.notice} role="alert"><AlertCircle size={17} aria-hidden="true"/><span>{notice}</span></p>}
   {restoring?<p className={styles.loading} role="status"><LoaderCircle size={17} className={styles.spin} aria-hidden="true"/><MiniPhrase en="Restoring your account…" am="መለያዎን በመመለስ ላይ…"/></p>:<>
    {status==='error'&&ready&&<p className={styles.status} role="status"><MiniPhrase en="Your previous session could not be restored. Sign in again to continue." am="የቀደመውን መግቢያዎን መመለስ አልቻልንም። ለመቀጠል እንደገና ይግቡ።"/></p>}
    {(!configuration.data||ready)&&<button className={styles.primary} type="button" disabled={!ready||pending} onClick={start} aria-busy={pending||configuration.isPending}>{pending||configuration.isPending?<LoaderCircle size={20} className={styles.spin} aria-hidden="true"/>:<TelegramMark/>}<MiniPhrase en={pending?'Opening Telegram…':configuration.isPending?'Connecting…':'Continue with Telegram'} am={pending?'Telegram በመክፈት ላይ…':configuration.isPending?'በመገናኘት ላይ…':'በTelegram ይቀጥሉ'}/></button>}
    {configuration.data&&!ready&&<div className={styles.unavailable}><p role="status"><MiniPhrase en="Website sign-in isn’t configured yet. You can use LowWin in Telegram or keep browsing." am="የድረ ገጽ መግቢያ ገና አልተዘጋጀም። LowWinን በTelegram ይክፈቱ ወይም መመልከት ይቀጥሉ።"/></p>{botUrl&&<TelegramBotLink className={styles.primary} href={botUrl}><TelegramMark/><MiniPhrase en="Open LowWin in Telegram" am="LowWinን በTelegram ይክፈቱ"/></TelegramBotLink>}</div>}
    {configuration.isError&&<div className={styles.unavailable}><p role="status"><MiniPhrase en="We couldn’t connect to sign-in. Check your connection and try again." am="ወደ መግቢያው መገናኘት አልቻልንም። ግንኙነትዎን ያረጋግጡና እንደገና ይሞክሩ።"/></p><button type="button" className={styles.retry} onClick={()=>void configuration.refetch()} disabled={configuration.isFetching}><MiniPhrase en={configuration.isFetching?'Connecting…':'Try again'} am={configuration.isFetching?'በመገናኘት ላይ…':'እንደገና ይሞክሩ'}/></button></div>}
   </>}
   {ready&&<p className={styles.explanation}><MiniPhrase en="Approve on Telegram, then return here. Use the same Telegram account to access your existing wallet and bids." am="በTelegram ያጽድቁና ወደዚህ ይመለሱ። ዋሌትዎን እና ጨረታዎችዎን ለመቀጠል ተመሳሳይ የTelegram መለያ ይጠቀሙ።"/></p>}
   {errorCode==='contact_required'&&botUrl&&<TelegramBotLink className={styles.secondary} href={botUrl}><MiniPhrase en="Finish registration in Telegram" am="ምዝገባን በTelegram ያጠናቅቁ"/></TelegramBotLink>}
   <button type="button" className={styles.browse} onClick={close}><MiniPhrase en="Keep browsing" am="መመልከት ይቀጥሉ"/></button>
   <p className={styles.security}><ShieldCheck size={14} aria-hidden="true"/><MiniPhrase en="Secure sign-in through Telegram" am="በTelegram ደህንነቱ የተጠበቀ መግቢያ"/></p>
  </div>
 </AccountSheet>;
}
