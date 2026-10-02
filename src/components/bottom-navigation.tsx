'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Bell,CircleUserRound,Heart,House,Layers,Trophy,Wallet} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';

const items=[
 {href:'/',en:'Home',am:'መነሻ',icon:House},
 {href:'/my-bids',en:'My Bids',am:'የእኔ ጨረታዎች',icon:Layers},
 {href:'/winning-bids',en:'Winning Bids',am:'ያሸነፉ ጨረታዎች',icon:Trophy},
 {href:'/wallet',en:'Deposit',am:'አስገባ',icon:Wallet},
 {href:'/profile/alerts',en:'My Alerts',am:'ማሳወቂያዎቼ',icon:Bell},
 {href:'/profile/favorites',en:'My Favorites',am:'ተወዳጆቼ',icon:Heart},
 {href:'/profile',en:'Profile',am:'መገለጫ',icon:CircleUserRound},
];
export function BottomNavigation(){
 const path=usePathname();
 const active=items.filter(({href})=>href==='/'?path==='/':path===href||path.startsWith(`${href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{items.map(({href,en,am,icon:Icon})=>{
  const deposit=href==='/wallet';
  return <Link prefetch={false} key={href} href={deposit?'/wallet#add-etb':href} className={`${styles.item} ${deposit?styles.deposit:''}`} aria-current={active===href?'page':undefined}>{deposit?<span className={styles.depositIcon}><Icon size={26} aria-hidden="true"/></span>:<Icon size={20} aria-hidden="true"/>}<span className={styles.label}><MiniPhrase en={en} am={am}/></span></Link>;
 })}</nav>;
}
