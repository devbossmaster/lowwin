'use client';
import {usePathname} from 'next/navigation';
import {CircleUserRound,House,Layers,Trophy,Gavel} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';

const items=[
 {href:'/',en:'Home',am:'መነሻ',icon:House},
 {href:'/draws',en:'Draws',am:'ውጤቶች',icon:Trophy},
 {href:'/auctions/all',en:'Auctions',am:'ጨረታዎች',icon:Gavel},
 {href:'/my-bids',en:'My Bids',am:'ጨረታዎቼ',icon:Layers},
 {href:'/profile',en:'Profile',am:'መገለጫ',icon:CircleUserRound},
];
export function BottomNavigation(){
 const path=usePathname();
 const active=path==='/payments'?'/profile':items.filter(({href})=>href==='/'?path==='/':href==='/auctions/all'?path.startsWith('/auctions')||path.startsWith('/categories'):href==='/my-bids'&&path==='/winning-bids'?true:path===href||path.startsWith(`${href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{items.map(({href,en,am,icon:Icon})=>{
  const deposit=href==='/auctions/all';
  const content=<>{deposit?<span className={styles.depositIcon}><Icon size={26} aria-hidden="true"/></span>:<Icon size={20} aria-hidden="true"/>}<span className={styles.label}><MiniPhrase en={en} am={am}/></span></>;
  const linkProps={href,className:`${styles.item} ${deposit?styles.deposit:''}`,"aria-current":active===href?'page' as const:undefined,children:content};
  // Personal routes serialize a client shell, not account data. Only warm
  // the selected route on hover, touch or keyboard focus; API data stays in
  // the identity-scoped private query cache.
  return <IntentPrefetchLink key={href} {...linkProps}/>;
 })}</nav>;
}
