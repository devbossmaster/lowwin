'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {TelegramLink} from './telegram-link';
import {TelegramSupportLink} from './telegram-support-link';

export function AppShell({children,requireLaunch=false}:{children:React.ReactNode;requireLaunch?:boolean}){
 const path=usePathname();
 const {status}=useTelegram();
 if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
 return <div className="app-frame">
  <MiniHeader/>
  <main id="main">{children}</main>
  {path==='/'&&<footer className="page-footer"><div className="footer-links"><Link href="/faq"><MiniPhrase en="FAQ" am="ጥያቄዎች"/></Link><Link href="/terms"><MiniPhrase en="Terms & Conditions" am="ውሎች እና ደንቦች"/></Link><Link href="/privacy"><MiniPhrase en="Privacy" am="ግላዊነት"/></Link><TelegramLink>Telegram</TelegramLink></div><small>© 2026 Lowin · Telegram Mini App</small></footer>}
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div>;
}
