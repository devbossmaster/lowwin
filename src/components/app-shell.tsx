'use client';
import {useCallback,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ArrowUpRight,Bell,CircleUserRound,Heart,House,Layers,Trophy,Wallet} from 'lucide-react';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import {MiniNavigation} from './mini-navigation';
import {useTelegram} from './telegram-provider';
import {MiniPhrase} from './mini-locale';
import {CatalogSkeleton} from './catalog-skeleton';

const nav=[
 {href:'/',en:'Home',am:'መነሻ',icon:House},
 {href:'/my-bids',en:'My Bids',am:'የእኔ ጨረታዎች',icon:Layers},
 {href:'/profile/wins',en:'Winning Bids',am:'ያሸነፉ ጨረታዎች',icon:Trophy},
 {href:'/wallet',en:'Deposit',am:'ገንዘብ ያስገቡ',icon:Wallet},
 {href:'/profile/alerts',en:'My Alerts',am:'ማሳወቂያዎቼ',icon:Bell},
 {href:'/profile/favorites',en:'My Favorites',am:'ተወዳጆቼ',icon:Heart},
 {href:'/profile',en:'Profile',am:'መገለጫ',icon:CircleUserRound},
];

export function AppShell({children,requireLaunch=false}:{children:React.ReactNode;requireLaunch?:boolean}){
 const path=usePathname();
 const {status}=useTelegram();
 const activeHref=nav.filter(({href})=>href==='/'?path==='/':path===href||path.startsWith(`${href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 const [launchOpened,setLaunchOpened]=useState(false);
 const completeLaunch=useCallback(()=>setLaunchOpened(true),[]);
 if(requireLaunch&&!launchOpened)return <TelegramEntry onComplete={completeLaunch}/>;
 if(requireLaunch&&(status==='guest'||status==='error'||status==='contact-required'))return <TelegramEntry onComplete={completeLaunch}/>;
 return <div className={`app-frame ${status==='loading'?'app-frame-loading':''}`} aria-busy={status==='loading'}>
  <MiniHeader/>
  <MiniNavigation/>
  <main id="main" className={status==='loading'?'app-main-loading':undefined}>{children}{status==='loading'&&<CatalogSkeleton/>}</main>
  <footer className="page-footer"><img className="footer-logo" src="/logo.png" alt="Lowwin" width="92" height="92"/><p><MiniPhrase en="Bid low. Win differently." am="በዝቅተኛ ዋጋ ተጫረቱ፣ በተለየ መንገድ ያሸንፉ።"/></p><div className="footer-links"><Link href="/auctions/all"><MiniPhrase en="Auctions" am="ጨረታዎች"/></Link><Link href="/winners/all"><MiniPhrase en="Results" am="ውጤቶች"/></Link><Link href="/faq"><MiniPhrase en="How it works" am="እንዴት ይሰራል?"/></Link></div><small>Telegram Mini App · © 2026 Lowwin</small><Link className="footer-rules" href="/faq"><MiniPhrase en="Understand the rules" am="ደንቦቹን ይረዱ"/> <ArrowUpRight size={14}/></Link></footer>
  <nav className="bottom-nav" aria-label="Your navigation">{nav.map(({href,en,am,icon:Icon})=><Link prefetch={false} key={href} href={href==='/wallet'?'/wallet#add-etb':href} className={href==='/wallet'?'bottom-nav-wallet':undefined} aria-current={activeHref===href?'page':undefined}>{href==='/wallet'?<span className="bottom-nav-wallet-icon"><Icon size={25} aria-hidden="true"/></span>:<Icon size={21} aria-hidden="true"/>}<span className="bottom-nav-label"><MiniPhrase en={en} am={am}/></span></Link>)}</nav>
 </div>;
}
