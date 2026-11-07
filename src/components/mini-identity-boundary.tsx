'use client';
import {preinit} from 'react-dom';
import {lazy,Suspense} from 'react';
import {usePathname} from 'next/navigation';
import {TELEGRAM_SDK_URL} from '@/lib/telegram-sdk-client';
import {TelegramProvider,useTelegram} from './telegram-provider';
import {MiniQueryProvider} from './mini-query-provider';
import {ChapaLaunchRouter} from './chapa-launch-router';
const RegistrationSheet=lazy(()=>import('./contact-gate').then(module=>({default:module.ContactGate})));
function RegistrationHost(){const {registrationOpen}=useTelegram();return registrationOpen?<Suspense fallback={null}><RegistrationSheet/></Suspense>:null}

/** One identity lifetime across /telegram and customer navigation; staff stays separate. */
export function MiniIdentityBoundary({children,devEnabled,botUrl}:{children:React.ReactNode;devEnabled:boolean;botUrl:string|null}){
 const path=usePathname();
 if(path==='/admin'||path.startsWith('/admin/'))return children;
 preinit(TELEGRAM_SDK_URL,{as:'script',fetchPriority:'high'});
 return <MiniQueryProvider><TelegramProvider devEnabled={devEnabled} botUrl={botUrl} requireLaunch={!devEnabled}><ChapaLaunchRouter>{children}</ChapaLaunchRouter><RegistrationHost/></TelegramProvider></MiniQueryProvider>;
}
