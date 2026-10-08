'use client';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {Bell,CircleUserRound,Heart,House,Layers,Trophy,Wallet} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';

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
  const content=<>{deposit?<span className={styles.depositIcon}><Icon size={26} aria-hidden="true"/></span>:<Icon size={20} aria-hidden="true"/>}<span className={styles.label}><MiniPhrase en={en} am={am}/></span></>;
  const linkProps={href:deposit?'/wallet#add-etb':href,className:`${styles.item} ${deposit?styles.deposit:''}`,"aria-current":active===href?'page' as const:undefined,children:content};
  // The landing page is public; personal pages stay opt-out to avoid keeping
  // private RSC payloads in Next's navigation prefetch cache across sessions.
  return href==='/'?<IntentPrefetchLink key={href} {...linkProps}/>:<Link key={href} {...linkProps} prefetch={false}/>;
 })}</nav>;
}
