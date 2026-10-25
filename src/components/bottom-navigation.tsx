'use client';
import {usePathname} from 'next/navigation';
import {CircleUserRound,House,Layers,Trophy} from 'lucide-react';
import {MiniPhrase} from './mini-locale';
import styles from './bottom-navigation.module.css';
import {IntentPrefetchLink} from './intent-prefetch-link';
import {useTelegram} from './telegram-provider';
import {miniNavigationState} from './mini-navigation-state';

const items=[
 {href:'/',en:'Home',am:'መነሻ',icon:House},
 {href:'/winners',en:'Winners',am:'አሸናፊዎች',icon:Trophy},
 {href:'/my-bids',en:'My Bids',am:'ጨረታዎቼ',icon:Layers},
 {href:'/profile',en:'Profile',am:'መገለጫ',icon:CircleUserRound},
];
export function BottomNavigation(){
 const path=usePathname(),{queryIdentity}=useTelegram();
 const active=path==='/payments'?'/profile':path.startsWith('/auctions')||path.startsWith('/categories')?'/':path.startsWith('/draws')?'/winners':items.filter(({href})=>href==='/'?path==='/':href==='/my-bids'&&path==='/winning-bids'?true:path===href||path.startsWith(`${href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
 return <nav className={`${styles.bar} mini-bottom-navigation`} aria-label="Your navigation">{items.map(({href,en,am,icon:Icon})=>{
  const content=<><Icon size={20} aria-hidden="true"/><span className={styles.label}><MiniPhrase en={en} am={am}/></span></>;
  const saved=miniNavigationState.visit(queryIdentity,href);
  const linkProps={href:saved?.href??href,scroll:saved&&saved.scrollY>0?false:undefined,className:styles.item,"aria-current":active===href?'page' as const:undefined,children:content};
  // Personal routes serialize a client shell, not account data. Only warm
  // the selected route on hover, touch or keyboard focus; API data stays in
  // the identity-scoped private query cache.
  return <IntentPrefetchLink key={href} {...linkProps}/>;
 })}</nav>;
}
