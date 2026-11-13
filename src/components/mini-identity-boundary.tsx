'use client';
import {preinit} from 'react-dom';
import {lazy,Suspense,useEffect,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {TELEGRAM_SDK_URL} from '@/lib/telegram-sdk-client';
import {TelegramProvider,useTelegram} from './telegram-provider';
import {MiniQueryProvider} from './mini-query-provider';
import {ChapaLaunchRouter} from './chapa-launch-router';
import {telegramBrowserLoginError} from '@/lib/telegram-browser-login-client';
const RegistrationSheet=lazy(()=>import('./contact-gate').then(module=>({default:module.ContactGate})));
const BrowserLogin=lazy(()=>import('./browser-telegram-login'));
function RegistrationHost(){
 const {registrationOpen,environment,openRegistration}=useTelegram(),checkedCallback=useRef(false);
 useEffect(()=>{if(environment==='detecting'||checkedCallback.current)return;checkedCallback.current=true;if(environment==='browser'&&telegramBrowserLoginError(new URLSearchParams(window.location.search).get('telegramLoginError')))openRegistration()},[environment,openRegistration]);
 return registrationOpen?<Suspense fallback={null}>{environment==='mini'?<RegistrationSheet/>:<BrowserLogin/>}</Suspense>:null;
}

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null}){
 const path=usePathname();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preinit(TELEGRAM_SDK_URL,{as:'script',fetchPriority:'high'});
 return <MiniQueryProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl}><ChapaLaunchRouter>{children}</ChapaLaunchRouter><RegistrationHost/></TelegramProvider></MiniQueryProvider>;
}
