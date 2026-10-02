'use client';
import {useCallback,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ArrowUpRight} from 'lucide-react';
import {BottomNavigation} from './bottom-navigation';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {MiniNavigation} from './mini-navigation';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {CatalogSkeleton} from './catalog-skeleton';
import {TelegramSupportLink} from './telegram-support-link';

export function AppShell({children,requireLaunch=false}:{children:React.ReactNode;requireLaunch?:boolean}){
 const path=usePathname();
 const {status}=useTelegram();
 const [launchOpened,setLaunchOpened]=useState(false);
 const completeLaunch=useCallback(()=>setLaunchOpened(true),[]);
 if(requireLaunch&&!launchOpened)return <TelegramEntry onComplete={completeLaunch}/>;
 if(requireLaunch&&(status==='guest'||status==='error'||status==='contact-required'))return <TelegramEntry onComplete={completeLaunch}/>;
 return <div className={`app-frame ${status==='loading'?'app-frame-loading':''}`} aria-busy={status==='loading'}>
  <MiniHeader/>
  <MiniNavigation/>
  <main id="main" className={status==='loading'?'app-main-loading':undefined}>{children}{status==='loading'&&<CatalogSkeleton/>}</main>
  {path==='/'&&<footer className="page-footer"><img className="footer-logo" src="/logo.png?v=forest-1" alt="Lowwin" width="92" height="92"/><p><MiniPhrase en="Bid low. Win differently." am="በዝቅተኛ ዋጋ ተጫረቱ፣ በተለየ መንገድ ያሸንፉ።"/></p><div className="footer-links"><Link href="/auctions/all"><MiniPhrase en="Auctions" am="ጨረታዎች"/></Link><Link href="/winners/all"><MiniPhrase en="Results" am="ውጤቶች"/></Link><Link href="/faq"><MiniPhrase en="How it works" am="እንዴት ይሰራል?"/></Link></div><small>Telegram Mini App · © 2026 Lowwin</small><Link className="footer-rules" href="/faq"><MiniPhrase en="Understand the rules" am="ደንቦቹን ይረዱ"/> <ArrowUpRight size={14}/></Link></footer>}
  <TelegramSupportLink/>
  <BottomNavigation/>
 </div>;
}
