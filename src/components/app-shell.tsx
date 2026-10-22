'use client';
import {useCallback,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {TelegramSupportLink} from './telegram-support-link';

export function AppShell({children,requireLaunch=false}:{children:React.ReactNode;requireLaunch?:boolean}){
 const path=usePathname();
 const {status}=useTelegram();
 const [launchOpened,setLaunchOpened]=useState(false);
 const completeLaunch=useCallback(()=>setLaunchOpened(true),[]);
 if(requireLaunch&&!launchOpened)return <TelegramEntry onComplete={completeLaunch}/>;
 if(requireLaunch&&(status==='guest'||status==='error'||status==='contact-required'))return <TelegramEntry onComplete={completeLaunch}/>;
 return <div className="app-frame">
  <MiniHeader/>
  <main id="main">{children}</main>
  {path==='/'&&<footer className="page-footer"><div className="footer-links"><Link href="/faq"><MiniPhrase en="FAQ" am="ጥያቄዎች"/></Link><Link href="/terms"><MiniPhrase en="Terms" am="ውሎች"/></Link><Link href="/privacy"><MiniPhrase en="Privacy" am="ግላዊነት"/></Link></div><small>© 2026 Lowin · Telegram Mini App</small></footer>}
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div>;
}
