'use client';
import {useEffect,useRef} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {auctionStartPath} from '@/lib/auction-share-link';
import {useTelegram} from './telegram-provider';

/** Handle auction and result launches outside the dedicated Telegram entry. */
export function AuctionLaunchRouter(){
 const {environment,status}=useTelegram(),router=useRouter(),pathname=usePathname(),handled=useRef<string|null>(null);
 useEffect(()=>{
  if(environment!=='mini'||status!=='authenticated')return;
  const launch=window.Telegram?.WebApp?.initData;
  if(!launch||handled.current===launch)return;
  handled.current=launch;
  if(pathname==='/telegram')return;
  const destination=auctionStartPath(new URLSearchParams(launch).get('start_param'));
  if(destination&&destination!==pathname)router.replace(destination);
 },[environment,status,pathname,router]);
 return null;
}
