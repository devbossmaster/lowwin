'use client';
import {lazy,Suspense,useEffect} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniReturnPath} from '@/lib/mini-return';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {LaunchSplash} from './launch-splash';
const TelegramEntryRecovery=lazy(()=>import('./telegram-entry-recovery'));

export function TelegramEntry({onComplete}:{onComplete?:()=>void}={}){
  const pathname=usePathname(),router=useRouter();
  const {status}=useTelegram();
  const telegramLaunch=typeof window!=='undefined'&&Boolean(window.Telegram?.WebApp?.initData);
  useEffect(()=>{
    if(pathname==='/telegram'){
      const payment=chapaReturnStartPath(new URLSearchParams(window.Telegram?.WebApp?.initData).get('start_param'));
      const destination=payment??miniReturnPath(new URL(window.location.href).searchParams.get('next'));
      router.replace(destination+(destination.includes('#')?'':window.location.hash));return;
    }
    if(status!=='authenticated'||!telegramLaunch)return;
    // The mounted ChapaLaunchRouter resolves startapp once for this identity.
    // Replaying it here would reopen a dismissed payment on later navigation.
    if(onComplete){
      onComplete();
    }else{
      // A bot button may open an auction before a bound session exists.
      // Refresh the server's session view without remounting the query/return gate.
      router.refresh();
    }
  },[status,telegramLaunch,pathname,onComplete,router]);
  if(pathname==='/telegram')return null;
  if(status==='loading'||(status==='authenticated'&&telegramLaunch))return <LaunchSplash complete={status==='authenticated'}/>;
  return <Suspense fallback={<LaunchSplash/>}><TelegramEntryRecovery/></Suspense>;
}
