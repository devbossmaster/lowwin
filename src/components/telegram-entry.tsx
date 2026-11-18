'use client';
import {lazy,Suspense,useEffect} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {useTelegram} from './telegram-provider';
import {miniReturnPath} from '@/lib/mini-return';
import {customerLoginPath} from '@/lib/customer-login-entry';
import {isPublicMiniPage} from '@/lib/mini-public-routes';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {auctionStartPath} from '@/lib/auction-share-link';
import {LaunchSplash} from './launch-splash';
const TelegramEntryRecovery=lazy(()=>import('./telegram-entry-recovery'));

export function TelegramEntry({onComplete}:{onComplete?:()=>void}={}){
  const pathname=usePathname(),router=useRouter();
  const {status,environment}=useTelegram();
  const telegramLaunch=typeof window!=='undefined'&&Boolean(window.Telegram?.WebApp?.initData);
  useEffect(()=>{
    if(pathname==='/telegram'){
      if(environment==='detecting'||status==='loading'||environment==='mini'&&status!=='authenticated')return;
      const start=new URLSearchParams(window.Telegram?.WebApp?.initData).get('start_param');
      const payment=chapaReturnStartPath(start);
      const destination=payment??auctionStartPath(start)??miniReturnPath(new URL(window.location.href).searchParams.get('next'));
      const next=destination+(destination.includes('#')?'':window.location.hash);
      // Ordinary browser arrivals retain their public/protected route choice.
      router.replace(status==='authenticated'||isPublicMiniPage(new URL(next,window.location.origin).pathname)?next:customerLoginPath(next));return;
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
  },[status,environment,telegramLaunch,pathname,onComplete,router]);
  if(pathname==='/telegram')return <LaunchSplash/>;
  if(status==='loading'||(status==='authenticated'&&telegramLaunch))return <LaunchSplash complete={status==='authenticated'}/>;
  return <Suspense fallback={<LaunchSplash/>}><TelegramEntryRecovery/></Suspense>;
}
