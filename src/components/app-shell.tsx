'use client';
import {TelegramEntry} from './telegram-entry';
import {AlertBell} from './alert-bell';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, CircleUserRound, House, LayoutGrid, Trophy, Layers, ArrowUpRight, Wallet } from 'lucide-react';
import { useTelegram } from './telegram-provider';
const nav = [{ href: '/', text: 'Home', icon: House }, { href: '/auctions', text: 'Auctions', icon: LayoutGrid }, { href: '/winners', text: 'Winners', icon: Trophy }, { href: '/my-bids', text: 'My Bids', icon: Layers }, { href: '/profile', text: 'Profile', icon: CircleUserRound }];
export function AppShell({ children, requireLaunch=false }: { children: React.ReactNode; requireLaunch?:boolean }) {
  const path = usePathname(); const { me, status } = useTelegram();
  if(requireLaunch&&status!=='authenticated')return <TelegramEntry/>;
  return <div className="app-frame">
    <header className="topbar">
      <Link href="/" aria-label="Lowin home" className="wordmark">lowin<span>.</span></Link>
      <div className="header-actions">
        <Link className="balance-chip" href="/wallet" aria-label={me ? `${me.wallet.available} available points, open wallet` : 'Open point wallet'}><Wallet size={15}/><span>{me ? `${me.wallet.available} pts` : 'Points'}</span></Link>
        <AlertBell/>
        <Link href="/profile" className="avatar" aria-label="Profile">{me?.user.name.slice(0,1) || <CircleUserRound size={23}/>}</Link>
      </div>
    </header>
    {status === 'loading' && <div className="connection-line" role="status">Opening your Lowin…</div>}
    <main id="main">{children}</main>
    <footer className="page-footer"><span className="wordmark">lowin<span>.</span></span><p>A little different wins.</p><Link href="/faq">Understand the rules <ArrowUpRight size={14}/></Link></footer>
    <nav className="bottom-nav" aria-label="Main navigation">{nav.map(({ href, text, icon: Icon }) => <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}><Icon size={21}/><span>{text}</span></Link>)}</nav>
  </div>;
}
