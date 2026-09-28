'use client';
import {useCallback,useState} from 'react';
import {TelegramEntry} from './telegram-entry';
import {MiniHeader} from './mini-header';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleUserRound, House, LayoutGrid, Trophy, Layers, ArrowUpRight, Wallet } from 'lucide-react';
import { useTelegram } from './telegram-provider';
import {MiniPhrase,useMiniLocale,type MiniCopyKey} from './mini-locale';
import {CatalogSkeleton} from './catalog-skeleton';
const nav: {href:string;text:MiniCopyKey;icon:typeof House}[] = [{ href: '/', text: 'home', icon: House }, { href: '/auctions', text: 'auctions', icon: LayoutGrid }, { href: '/winners', text: 'winners', icon: Trophy }, { href: '/my-bids', text: 'myBids', icon: Layers }, { href: '/wallet', text: 'wallet', icon: Wallet }, { href: '/profile', text: 'profile', icon: CircleUserRound }];
export function AppShell({ children, requireLaunch=false }: { children: React.ReactNode; requireLaunch?:boolean }) {
  const path = usePathname(); const { status } = useTelegram();
  const {t}=useMiniLocale();
  const [launchOpened,setLaunchOpened]=useState(false);
  const completeLaunch=useCallback(()=>{delete document.documentElement.dataset.lowwinHandoff;setLaunchOpened(true)},[]);
  if(requireLaunch&&!launchOpened)return <TelegramEntry onComplete={completeLaunch}/>;
  if(requireLaunch&&(status==='guest'||status==='error'||status==='contact-required'))return <TelegramEntry onComplete={completeLaunch}/>;
  return <div className="app-frame">
    <MiniHeader/>
    {status === 'loading' && <div className="connection-line" role="status">Opening your Lowwin…</div>}
    <main id="main">{status==='loading'?<CatalogSkeleton/>:children}</main>
    <footer className="page-footer"><span className="wordmark">lowwin<span>.</span></span><p><MiniPhrase en="Bid low. Win differently." am="በዝቅተኛ ዋጋ ተጫረቱ፣ በተለየ መንገድ ያሸንፉ።"/></p><div className="footer-links"><Link href="/auctions"><MiniPhrase en="Auctions" am="ጨረታዎች"/></Link><Link href="/winners"><MiniPhrase en="Results" am="ውጤቶች"/></Link><Link href="/faq"><MiniPhrase en="How it works" am="እንዴት ይሰራል?"/></Link></div><small>Telegram Mini App · © 2026 Lowwin</small><Link className="footer-rules" href="/faq"><MiniPhrase en="Understand the rules" am="ደንቦቹን ይረዱ"/> <ArrowUpRight size={14}/></Link></footer>
    <nav className="bottom-nav" aria-label="Main navigation">{nav.map(({ href, text, icon: Icon }) => <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}><Icon size={21}/><span>{t(text)}</span></Link>)}</nav>
  </div>;
}
