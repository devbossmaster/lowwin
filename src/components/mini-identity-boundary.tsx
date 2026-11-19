'use client';
import {preinit} from 'react-dom';
import {lazy,Suspense,useEffect,useRef} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {TELEGRAM_SDK_URL} from '@/lib/telegram-sdk-client';
import {TelegramProvider,useTelegram} from './telegram-provider';
import {MiniQueryProvider} from './mini-query-provider';
import {ChapaLaunchRouter} from './chapa-launch-router';
import {AuctionLaunchRouter} from './auction-launch-router';
import {telegramBrowserLoginError,type TelegramBrowserLoginConfiguration} from '@/lib/telegram-browser-login-client';
import type {BrowserAccountBootstrap} from '@/lib/current-account';
import {customerLoginRequest,withoutCustomerLogin} from '@/lib/customer-login-entry';
import {MiniPhrase} from './mini-locale';
import {ContactGate} from './contact-gate';
import {LaunchSplash} from './launch-splash';
import styles from './browser-telegram-login.module.css';
const BrowserLogin=lazy(()=>import('./browser-telegram-login'));
const TelegramEntryRecovery=lazy(()=>import('./telegram-entry-recovery'));
export function RegistrationHost({browserLogin}:{browserLogin:TelegramBrowserLoginConfiguration}){
 const {registrationOpen,environment,openRegistration,status,me,queryIdentity}=useTelegram(),checkedCallback=useRef(false),path=usePathname(),params=useSearchParams(),router=useRouter();
 const requested=path==='/'?customerLoginRequest(new URLSearchParams(params.toString())):null;
 const handoff=useRef<{destination:string;opened:boolean}|null>(null);
 useEffect(()=>{
  if(!requested){handoff.current=null;return}
  if(!handoff.current||handoff.current.destination!==requested.destination)handoff.current={destination:requested.destination,opened:false};
  if(environment==='detecting'||status==='loading')return;
  if(status==='authenticated'&&me?.user?.id&&queryIdentity){router.replace(handoff.current.destination,{scroll:false});return}
  if(!handoff.current.opened){handoff.current.opened=true;openRegistration()}
 },[path,params,requested?.destination,environment,status,me,queryIdentity,router,openRegistration]);
 const wasOpen=useRef(false);
 useEffect(()=>{
  if(registrationOpen){wasOpen.current=true;return}
  if(wasOpen.current&&handoff.current&&status!=='authenticated'){
   wasOpen.current=false;handoff.current=null;router.replace(withoutCustomerLogin(window.location.href),{scroll:false});
  }
 },[registrationOpen,status,router]);
 useEffect(()=>{if(environment==='detecting'||checkedCallback.current)return;checkedCallback.current=true;if(environment==='browser'&&telegramBrowserLoginError(new URLSearchParams(window.location.search).get('telegramLoginError')))openRegistration()},[environment,openRegistration]);
 if(!registrationOpen||environment!=='browser')return null;
 return <Suspense fallback={<p className={styles.opening} role="status"><MiniPhrase en="Opening sign-in…" am="መግቢያውን በመክፈት ላይ…"/></p>}><BrowserLogin configuration={browserLogin}/></Suspense>;
}

function CustomerApplication({children,browserLogin}:{children:React.ReactNode;browserLogin:TelegramBrowserLoginConfiguration}){
 const {environment,status}=useTelegram(),path=usePathname();
 if(environment==='detecting'&&path==='/telegram')return <LaunchSplash/>;
 if(environment==='mini'){
  if(status==='loading')return <LaunchSplash/>;
  if(status==='contact-required')return <ContactGate/>;
  if(status!=='authenticated')return <Suspense fallback={<LaunchSplash/>}><TelegramEntryRecovery/></Suspense>;
 }
 return <><AuctionLaunchRouter/><ChapaLaunchRouter>{children}</ChapaLaunchRouter><Suspense fallback={null}><RegistrationHost browserLogin={browserLogin}/></Suspense></>;
}

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl,browserLogin,initialAccount}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null;browserLogin:TelegramBrowserLoginConfiguration;initialAccount?:Promise<BrowserAccountBootstrap>}){
 const path=usePathname();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preinit(TELEGRAM_SDK_URL,{as:'script',fetchPriority:'high'});
 return <MiniQueryProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl} initialAccount={initialAccount}><CustomerApplication browserLogin={browserLogin}>{children}</CustomerApplication></TelegramProvider></MiniQueryProvider>;
}
