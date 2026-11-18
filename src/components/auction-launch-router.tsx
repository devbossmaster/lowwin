'use client';
import {useEffect,useRef} from 'react';
import {useRouter} from 'next/navigation';
import {auctionStartPath} from '@/lib/auction-share-link';
import {useTelegram} from './telegram-provider';

/** A shared product is public browsing. Never initialize checkout on arrival. */
export function AuctionLaunchRouter(){
 const {environment,status}=useTelegram(),router=useRouter(),handled=useRef<string|null>(null);
 useEffect(()=>{
  if(environment!=='mini'||status!=='authenticated')return;
  const launch=window.Telegram?.WebApp?.initData;
  if(!launch||handled.current===launch)return;
  const path=auctionStartPath(new URLSearchParams(launch).get('start_param'));
  handled.current=launch;if(path)router.replace(path);
 },[environment,status,router]);
 return null;
}
