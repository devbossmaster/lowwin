'use client';
import {useEffect,useRef} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {chapaReturnStartPath} from '@/lib/chapa-return-link';
import {useTelegram} from './telegram-provider';

/** startapp identifies a payment, never its owner or outcome. The return route
 * reads the owned server record before choosing the bid/top-up surface. */
export function ChapaLaunchRouter(){
 const {status,queryIdentity,verifyingTelegram}=useTelegram(),router=useRouter(),pathname=usePathname(),handled=useRef<string|null>(null);
 useEffect(()=>{
  if(status!=='authenticated'||!queryIdentity||verifyingTelegram||pathname==='/telegram')return;
  const launch=window.Telegram?.WebApp?.initData;if(!launch)return;
  const path=chapaReturnStartPath(new URLSearchParams(launch).get('start_param'));
  if(!path)return;
  const key=queryIdentity+':'+launch;if(handled.current===key)return;handled.current=key;
  // An explicit return URL takes precedence over an older launch parameter.
  if(pathname==='/payments/chapa/return')return;
  if(window.location.pathname+window.location.search!==path)router.replace(path,{scroll:false});
 },[status,queryIdentity,verifyingTelegram,router,pathname]);
 return null;
}
