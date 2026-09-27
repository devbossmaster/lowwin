'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Bell} from 'lucide-react';
import {useTelegram} from './telegram-provider';
export function AlertBell(){const {me,status}=useTelegram(),[count,setCount]=useState(0);useEffect(()=>{setCount(0);if(status!=='authenticated')return;let live=true;const refresh=async()=>{try{const r=await fetch('/api/alerts',{cache:'no-store'});if(r.ok&&live)setCount((await r.json()).unread)}catch{}};void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh()},30000);window.addEventListener('lowin-alerts',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('lowin-alerts',refresh)}},[status,me?.user.id]);return <Link href="/profile/alerts" className="icon-button alert-bell" aria-label={`Alerts${count?`, ${count} unread`:''}`}><Bell size={20}/>{count>0&&<span>{count>99?'99+':count}</span>}</Link>}
