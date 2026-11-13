'use client';
import {preinit} from 'react-dom';
import {lazy,Suspense,useEffect,useRef} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {TELEGRAM_SDK_URL} from '@/lib/telegram-sdk-client';
import {TelegramProvider,useTelegram} from './telegram-provider';
import {MiniQueryProvider} from './mini-query-provider';
import {ChapaLaunchRouter} from './chapa-launch-router';
import {telegramBrowserLoginError} from '@/lib/telegram-browser-login-client';
import {customerLoginRequest,withoutCustomerLogin} from '@/lib/customer-login-entry';
const RegistrationSheet=lazy(()=>import('./contact-gate').then(module=>({default:module.ContactGate})));
const BrowserLogin=lazy(()=>import('./browser-telegram-login'));
export function RegistrationHost(){
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
 return registrationOpen&&environment!=='detecting'?<Suspense fallback={null}>{environment==='mini'?<RegistrationSheet/>:<BrowserLogin/>}</Suspense>:null;
}

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null}){
 const path=usePathname();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preinit(TELEGRAM_SDK_URL,{as:'script',fetchPriority:'high'});
 return <MiniQueryProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl}><ChapaLaunchRouter>{children}</ChapaLaunchRouter><Suspense fallback={null}><RegistrationHost/></Suspense></TelegramProvider></MiniQueryProvider>;
}
