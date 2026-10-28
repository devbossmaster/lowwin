'use client';
import {lazy,Suspense,useEffect} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniReturnPath} from '@/lib/mini-return';
import {LaunchSplash} from './launch-splash';
const ContactGate=lazy(()=>import('./contact-gate').then(module=>({default:module.ContactGate})));
const TelegramEntryRecovery=lazy(()=>import('./telegram-entry-recovery'));

export function TelegramEntry({onComplete}:{onComplete?:()=>void}={}){
  const pathname=usePathname(),router=useRouter();
  const {status}=useTelegram();
  const telegramLaunch=typeof window!=='undefined'&&Boolean(window.Telegram?.WebApp?.initData);
  useEffect(()=>{
    if(status!=='authenticated'||!telegramLaunch)return;
    if(pathname==='/telegram'){
      const destination=miniReturnPath(new URL(window.location.href).searchParams.get('next'));
      router.replace(destination+(destination.includes('#')?'':window.location.hash));
    }else if(onComplete){
      onComplete();
    }else{
      // A bot button may open an auction before a bound session exists.
      // Sign in here, then reload the original path instead of losing it.
      window.location.reload();
    }
  },[status,telegramLaunch,pathname,onComplete,router]);
  if(status==='contact-required')return <Suspense fallback={<LaunchSplash/>}><ContactGate/></Suspense>;
  if(status==='loading'||(status==='authenticated'&&telegramLaunch))return <LaunchSplash complete={status==='authenticated'}/>;
  return <Suspense fallback={<LaunchSplash/>}><TelegramEntryRecovery/></Suspense>;
}
