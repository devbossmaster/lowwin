'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Bell} from 'lucide-react';
import {useTelegram} from './telegram-provider';
import {Button} from './ui/button';

export function AlertBell({className,indicatorClassName}:{className?:string;indicatorClassName?:string}){
 const {me,status}=useTelegram();
 const userId=status==='authenticated'?me?.user.id:undefined;
 const [result,setResult]=useState<{userId:string;unread:number}|null>(null);
 useEffect(()=>{
  if(!userId)return;
  const controller=new AbortController();let request=0;
  const refresh=async()=>{
   const current=++request;
   try{
    const response=await fetch('/api/alerts',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Alerts unavailable');
    const {unread}=await response.json();
    if(!controller.signal.aborted&&current===request)setResult(Number.isSafeInteger(unread)&&unread>=0?{userId,unread}:null);
   }catch{if(!controller.signal.aborted&&current===request)setResult(null)}
  };
  void refresh();
  const timer=setInterval(()=>{if(!document.hidden)void refresh()},30000);
  window.addEventListener('lowin-alerts',refresh);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('lowin-alerts',refresh)};
 },[userId]);
 const count=userId&&result?.userId===userId?result.unread:null;
 return <Button asChild variant="outline" className={className}><Link href="/profile/alerts" aria-label={`Alerts${count?`, ${count} unread`:''}`}><Bell size={21} aria-hidden="true"/>{count!==null&&count>0&&<span className={indicatorClassName} data-unread-indicator aria-hidden="true"/>}</Link></Button>;
}
